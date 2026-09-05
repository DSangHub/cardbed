const store = require("../store");
const grok = require("../services/grok");
const stripeCards = require("../services/stripeCards");
const sleep = require("../services/sleep");
const market = require("../services/market");
const barcode = require("../services/barcode");
const { send } = require("../http");

function userFrom(db) {
  return db.users[0];
}

function publicCard(card) {
  sleep.applySchedule(card);
  return {
    id: card.id,
    nickname: card.nickname,
    brand: card.brand,
    last4: card.last4,
    expMonth: card.expMonth,
    expYear: card.expYear,
    status: card.status,
    sleep: card.sleep,
    snoozeUntil: card.snoozeUntil,
    createdAt: card.createdAt,
  };
}

function publicProduct(product) {
  const stats = store.stats(product);
  return { ...product, stats, allInCents: stats.allIn };
}

function publicOrder(order, db) {
  const product = db.products.find((p) => p.id === order.productId);
  const card = db.cards.find((c) => c.id === order.cardId);
  const { fillCeiling, nudgeCeiling } = market.bands(order);
  return {
    ...order,
    fillCeilingCents: fillCeiling,
    nudgeCeilingCents: nudgeCeiling,
    product: product
      ? {
          id: product.id,
          name: product.name,
          image: product.image,
          currentCents: product.currentCents,
          merchant: product.merchant,
        }
      : null,
    card: card ? { id: card.id, last4: card.last4, status: card.status } : null,
  };
}

function sanitizeSleep(input) {
  const out = {};
  if (input.bedtime) out.bedtime = input.bedtime;
  if (input.wakeTime) out.wakeTime = input.wakeTime;
  if (input.timezone) out.timezone = input.timezone;
  if (typeof input.allowAutoBuyWhileAsleep === "boolean") {
    out.allowAutoBuyWhileAsleep = input.allowAutoBuyWhileAsleep;
  }
  if (input.locationLock) out.locationLock = input.locationLock;
  if (typeof input.enabled === "boolean") out.enabled = input.enabled;
  return out;
}

async function handleApi(req, res, url, body) {
  const method = req.method;
  const parts = url.pathname.replace(/^\/api\//, "").split("/").filter(Boolean);

  const match = (m, ...seg) => {
    if (method !== m || parts.length !== seg.length) return false;
    const params = {};
    for (let i = 0; i < seg.length; i++) {
      if (seg[i].startsWith(":")) params[seg[i].slice(1)] = parts[i];
      else if (seg[i] !== parts[i]) return false;
    }
    match.params = params;
    return true;
  };

  try {
    if (match("GET", "health")) {
      return send(res, 200, {
        ok: true,
        stripe: stripeCards.mode(),
        grok: require("../config").xai.apiKey ? "live" : "local_fallback",
      });
    }

    if (match("GET", "state")) {
      const db = store.load();
      const user = userFrom(db);
      return send(res, 200, {
        user,
        payments: stripeCards.mode(),
        cards: db.cards.filter((c) => c.userId === user.id).map(publicCard),
        products: db.products.map(publicProduct),
        orders: db.orders.filter((o) => o.userId === user.id).map((o) => publicOrder(o, db)),
        alarms: db.alarms
          .filter((a) => a.userId === user.id)
          .slice(0, 30)
          .map((a) => ({
            ...a,
            product: db.products.find((p) => p.id === a.productId),
          })),
        events: db.events.slice(0, 40),
      });
    }

    if (match("POST", "cards", "setup-intent")) {
      const db = store.load();
      const user = userFrom(db);
      const out = await stripeCards.createSetupIntent(user);
      store.mutate((d) => {
        d.users.find((x) => x.id === user.id).stripeCustomerId = user.stripeCustomerId;
      });
      return send(res, 200, out);
    }

    if (match("POST", "cards", "demo")) {
      const db = store.load();
      const user = userFrom(db);
      const card = await stripeCards.attachDemoCard(user, body || {});
      store.mutate((d) => {
        d.cards.push(card);
        d.events.unshift({
          id: store.uuid(),
          type: "card",
          message: `${card.nickname} •${card.last4} tucked into CardBed.`,
          createdAt: store.now(),
        });
      });
      return send(res, 200, publicCard(card));
    }

    if (match("POST", "cards", "attach")) {
      const db = store.load();
      const user = userFrom(db);
      const card = await stripeCards.attachStripePaymentMethod(
        user,
        body.paymentMethodId,
        body.nickname
      );
      store.mutate((d) => d.cards.push(card));
      return send(res, 200, publicCard(card));
    }

    if (match("POST", "cards", ":id", "sleep")) {
      const card = store.mutate((db) => {
        const c = db.cards.find((x) => x.id === match.params.id);
        if (!c) return null;
        if (body.mode === "wake") sleep.wakeNow(c);
        else if (body.mode === "snooze") sleep.snooze(c, Number(body.minutes || 30));
        else {
          sleep.sleepNow(c);
          c.sleep = { ...c.sleep, ...sanitizeSleep(body.sleep || body) };
          c.sleep.enabled = true;
          sleep.applySchedule(c);
        }
        db.events.unshift({
          id: store.uuid(),
          type: "sleep",
          message: `${c.nickname} is ${c.status}.`,
          createdAt: store.now(),
        });
        return c;
      });
      if (!card) return send(res, 404, { error: "Card not found" });
      return send(res, 200, publicCard(card));
    }

    if (match("POST", "cards", ":id", "schedule")) {
      const card = store.mutate((db) => {
        const c = db.cards.find((x) => x.id === match.params.id);
        if (!c) return null;
        c.sleep = { ...c.sleep, ...sanitizeSleep(body || {}), enabled: true };
        sleep.applySchedule(c);
        return c;
      });
      if (!card) return send(res, 404, { error: "Card not found" });
      return send(res, 200, publicCard(card));
    }

    if (match("POST", "products", ":id", "analyze")) {
      const db = store.load();
      const product = db.products.find((p) => p.id === match.params.id);
      if (!product) return send(res, 404, { error: "Product not found" });
      const thesis = await grok.analyzeProduct(product, store.stats(product));
      return send(res, 200, { product: publicProduct(product), thesis });
    }

    if (match("POST", "orders")) {
      const created = store.mutate((db) => {
        const user = userFrom(db);
        const product = db.products.find((p) => p.id === body.productId);
        const card = db.cards.find((c) => c.id === body.cardId);
        if (!product) throw new Error("Product required");
        if (!card) throw new Error("Choose a card to wake for the fill");
        if (!body.limitCents) throw new Error("Limit price required");
        const existing = db.orders.find(
          (o) => o.userId === user.id && o.productId === body.productId && o.status === "working"
        );
        if (existing) throw new Error("One working order per item");
        const order = {
          id: `ord_${store.uuid()}`,
          userId: user.id,
          productId: body.productId,
          cardId: body.cardId,
          type: body.type || "limit",
          limitCents: Number(body.limitCents),
          bandCents: Number(body.bandCents ?? 200),
          nudgeCeilingCents: body.nudgeCeilingCents ? Number(body.nudgeCeilingCents) : undefined,
          qty: 1,
          status: "working",
          expiresAt: new Date(
            Date.now() + (Number(body.expiresInDays) || 90) * 86400000
          ).toISOString(),
          createdAt: store.now(),
          lastSignalCents: null,
          lastSignalKind: null,
        };
        if (!order.nudgeCeilingCents) {
          const allIn = market.allIn(product);
          order.nudgeCeilingCents = Math.max(
            order.limitCents + order.bandCents + 50,
            Math.round((order.limitCents + order.bandCents + allIn) / 2)
          );
        }
        db.orders.unshift(order);
        db.events.unshift({
          id: store.uuid(),
          type: "order",
          message: `Limit working on ${product.name}: $${(order.limitCents / 100).toFixed(2)} ± $${(order.bandCents / 100).toFixed(2)}`,
          createdAt: store.now(),
        });
        return publicOrder(order, db);
      });
      return send(res, 200, created);
    }

    if (match("POST", "orders", ":id", "cancel")) {
      const order = store.mutate((db) => {
        const o = db.orders.find((x) => x.id === match.params.id);
        if (!o) return null;
        if (o.status === "working") o.status = "canceled";
        return o;
      });
      if (!order) return send(res, 404, { error: "Order not found" });
      return send(res, 200, order);
    }

    if (match("POST", "alarms", ":id", "answer")) {
      const result = await market.answerAlarm(match.params.id, body.answer);
      return send(res, 200, result);
    }

    if (match("POST", "sim", "tick")) {
      market.tickMarket();
      const fired = await market.evaluateOpenOrders();
      return send(res, 200, { fired });
    }

    if (match("POST", "scan")) {
      const resolved = await barcode.resolveBarcode(body.barcode);
      const thesis = await grok.analyzeProduct(resolved.product, store.stats(resolved.product));
      let order = null;
      if (body.arm && body.cardId) {
        const db = store.load();
        const user = userFrom(db);
        const card = db.cards.find((c) => c.id === body.cardId);
        if (!card) throw new Error("Choose a card before arming a scan");
        const existing = db.orders.find(
          (o) => o.userId === user.id && o.productId === resolved.product.id && o.status === "working"
        );
        if (existing) {
          order = publicOrder(existing, db);
        } else {
          order = store.mutate((d) => {
            const placed = {
              id: `ord_${store.uuid()}`,
              userId: user.id,
              productId: resolved.product.id,
              cardId: body.cardId,
              type: body.arm === "limit" ? "limit" : "alert_only",
              limitCents: Number(body.limitCents || thesis.suggestedLimitCents),
              bandCents: Number(body.bandCents || thesis.suggestedBandCents || 200),
              qty: 1,
              status: "working",
              source: "barcode_scan",
              expiresAt: new Date(Date.now() + 90 * 86400000).toISOString(),
              createdAt: store.now(),
              lastSignalCents: null,
              lastSignalKind: null,
            };
            const allIn = market.allIn(resolved.product);
            placed.nudgeCeilingCents = Math.max(
              placed.limitCents + placed.bandCents + 50,
              Math.round((placed.limitCents + placed.bandCents + allIn) / 2)
            );
            d.orders.unshift(placed);
            d.events.unshift({
              id: store.uuid(),
              type: "scan",
              message: `Scan armed ${resolved.product.name} at ${placed.type} ${placed.limitCents / 100} ± ${placed.bandCents / 100}`,
              createdAt: store.now(),
            });
            return publicOrder(placed, d);
          });
        }
      }
      return send(res, 200, {
        barcode: resolved.barcode,
        created: resolved.created,
        product: publicProduct(resolved.product),
        thesis,
        order,
        demoUpcs: barcode.DEMO_UPCS,
      });
    }

    if (match("GET", "scan", "demo-codes")) {
      barcode.stampDemoBarcodes();
      return send(res, 200, { codes: barcode.DEMO_UPCS });
    }

    if (match("POST", "sim", "drop", ":productId")) {
      store.mutate((db) => {
        const p = db.products.find((x) => x.id === match.params.productId);
        if (!p) throw new Error("Product not found");
        if (body.cents) p.currentCents = Number(body.cents);
        p.history.push({ t: Date.now(), cents: p.currentCents });
      });
      const fired = await market.evaluateOpenOrders();
      return send(res, 200, { fired });
    }

    return send(res, 404, { error: "Unknown API route" });
  } catch (err) {
    return send(res, 400, { error: err.message });
  }
}

module.exports = handleApi;
