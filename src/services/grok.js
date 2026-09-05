const config = require("../config");

const SYSTEM = `You are Grok inside CardBed, a card-sleep and limit-buy app.
Treat each saved product like a stock limit order.
Return ONLY valid JSON with this shape:
{
  "thesis": "1-2 sentence stock-style take",
  "suggestedLimitCents": number,
  "suggestedBandCents": number,
  "fillCeilingCents": number,
  "nudgeCeilingCents": number,
  "confidence": "low" | "medium" | "high",
  "compareToStock": "how this maps to a limit / limit-if-touched / alert",
  "risks": ["short strings"]
}
Prices are integer cents. suggestedLimitCents must be below current all-in price.
Band is typically 100-400 cents. fillCeiling = limit + band.
nudgeCeiling is a near-miss alert line between current and fillCeiling.`;

async function analyzeProduct(product, stats) {
  const payload = {
    name: product.name,
    sku: product.sku,
    merchant: product.merchant,
    currentCents: product.currentCents,
    allInCents: stats.allIn,
    low90Cents: stats.low90,
    high90Cents: stats.high90,
    dropFromHighPct: stats.dropFromHighPct,
    shippingCents: product.shippingCents,
    taxRate: product.taxRate,
  };

  if (!config.xai.apiKey) {
    return localThesis(product, stats);
  }

  try {
    const res = await fetch(`${config.xai.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.xai.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.xai.model,
        temperature: 0.3,
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: `Write a limit-order ticket for this item:\n${JSON.stringify(payload)}`,
          },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`xAI ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || "";
    const parsed = extractJson(raw);
    if (!parsed) throw new Error("Grok returned no JSON");
    return { ...parsed, source: "grok", model: config.xai.model };
  } catch (err) {
    const fallback = localThesis(product, stats);
    fallback.source = "local_fallback";
    fallback.error = err.message;
    return fallback;
  }
}

async function draftAlarmCopy({ product, order, quoteCents, kind }) {
  const user = `Write a 2-sentence bedside alarm for CardBed.
Kind: ${kind}
Item: ${product.name} at ${product.merchant}
Quote (cents): ${quoteCents}
Limit (cents): ${order.limitCents}
Band (cents): ${order.bandCents}
Fill ceiling (cents): ${order.limitCents + order.bandCents}
Return plain text only.`;

  if (!config.xai.apiKey) {
    if (kind === "fill") {
      return `${product.name} filled inside your band at ${fmt(quoteCents)}. The card woke, paid, and went back to bed.`;
    }
    return `${product.name} dipped to ${fmt(quoteCents)} — not inside your ${fmt(order.limitCents)} ± ${fmt(order.bandCents)} band. Buy, tighten the limit, or snooze?`;
  }

  try {
    const res = await fetch(`${config.xai.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.xai.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.xai.model,
        temperature: 0.5,
        messages: [
          {
            role: "system",
            content: "You write short bedside alarms for a finance app. No markdown. No emoji spam.",
          },
          { role: "user", content: user },
        ],
      }),
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || localAlarm(kind, product, quoteCents, order);
  } catch {
    return localAlarm(kind, product, quoteCents, order);
  }
}

function localThesis(product, stats) {
  const limit = snap(stats.low90 + Math.round((stats.current - stats.low90) * 0.15));
  const band = stats.current > 10000 ? 200 : 100;
  const fillCeiling = limit + band;
  const nudge = Math.min(stats.allIn - 1, Math.round((fillCeiling + stats.allIn) / 2));
  return {
    thesis: `${product.name} is ${stats.dropFromHighPct}% off its 90-day high. Treat the 90-day low (${fmt(stats.low90)}) as support and work a limit like a stock, not a hope.`,
    suggestedLimitCents: limit,
    suggestedBandCents: band,
    fillCeilingCents: fillCeiling,
    nudgeCeilingCents: nudge,
    confidence: stats.dropFromHighPct > 15 ? "medium" : "low",
    compareToStock:
      "Limit buy with a fill band (limit + slippage). Prints inside the band fill automatically. Prints between the band and nudge ceiling fire a Y/N alarm — a limit-if-touched that does not send the order until you tap Yes.",
    risks: [
      "All-in price must include tax and shipping or the fill is a fake dip.",
      "Flash prices that vanish at checkout must abort to Y/N.",
    ],
    source: "local",
    model: "cardbed-analyst",
  };
}

function localAlarm(kind, product, quoteCents, order) {
  if (kind === "fill") {
    return `${product.name} filled at ${fmt(quoteCents)} inside ${fmt(order.limitCents)} ± ${fmt(order.bandCents)}.`;
  }
  return `${product.name} is down to ${fmt(quoteCents)}. Your auto-buy band is ${fmt(order.limitCents)} ± ${fmt(order.bandCents)}. Buy?`;
}

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function snap(n) {
  return Math.max(50, Math.round(n / 25) * 25);
}

function fmt(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

module.exports = { analyzeProduct, draftAlarmCopy };
