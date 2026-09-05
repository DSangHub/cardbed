const store = require("../store");
const grok = require("./grok");
const sleep = require("./sleep");
const stripeCards = require("./stripeCards");

function allIn(product, cents = product.currentCents) {
  return Math.round(cents * (1 + (product.taxRate || 0)) + (product.shippingCents || 0));
}

function bands(order) {
  const fillCeiling = order.limitCents + order.bandCents;
  const nudgeCeiling = order.nudgeCeilingCents ?? Math.round((fillCeiling + order.limitCents * 1.4));
  return { fillCeiling, nudgeCeiling };
}

function classifyQuote(order, quoteCents) {
  const { fillCeiling, nudgeCeiling } = bands(order);
  if (quoteCents <= fillCeiling) return "fill";
  if (quoteCents <= nudgeCeiling) return "nudge";
  return "hold";
}

function jitterProduct(product) {
  const stats = store.stats(product);
  const swing = Math.max(25, Math.round((stats.high90 - stats.low90) * 0.02));
  const delta = Math.round((Math.random() - 0.52) * swing);
  let next = product.currentCents + delta;
  next = Math.max(stats.low90 - 200, Math.min(stats.high90 + 100, next));
  product.currentCents = next;
  product.history.push({ t: Date.now(), cents: next });
  if (product.history.length > 180) product.history.splice(0, product.history.length - 180);
  return next;
}

async function evaluateOpenOrders() {
  const fired = [];
  const db = store.load();
  const open = db.orders.filter((o) => o.status === "working");

  for (const order of open) {
    const product = db.products.find((p) => p.id === order.productId);
    if (!product) continue;
    if (order.expiresAt && Date.parse(order.expiresAt) < Date.now()) {
      store.mutate((d) => {
        const o = d.orders.find((x) => x.id === order.id);
        if (o) o.status = "expired";
        d.events.unshift({
          id: store.uuid(),
          type: "order",
          message: `${product.name} order expired like an unfilled limit.`,
          createdAt: store.now(),
        });
      });
      continue;
    }

    const quote = allIn(product);
    const kind = classifyQuote(order, quote);
    if (kind === "hold") continue;
    if (order.lastSignalCents === quote && order.lastSignalKind === kind) continue;

    if (kind === "fill" && order.type !== "alert_only") {
      const result = await tryFill(order.id, quote);
      fired.push(result);
    } else {
      const result = await raiseAlarm(order.id, quote, "nudge");
      fired.push(result);
    }
  }
  return fired;
}

async function tryFill(orderId, quoteCents) {
  const db = store.load();
  const order = db.orders.find((o) => o.id === orderId);
  const product = db.products.find((p) => p.id === order.productId);
  const card = db.cards.find((c) => c.id === order.cardId);
  const user = db.users.find((u) => u.id === order.userId);

  if (!order || !product || !card || !user) return { ok: false, error: "missing" };

  if (user.monthlyAutoBuySpentCents + quoteCents > user.monthlyAutoBuyCapCents) {
    return raiseAlarm(orderId, quoteCents, "cap");
  }

  const gate = sleep.canCharge(card, { isAutoBuy: true });
  if (!gate.ok) return raiseAlarm(orderId, quoteCents, "asleep");

  const live = allIn(product);
  if (live !== quoteCents && classifyQuote(order, live) !== "fill") {
    return raiseAlarm(orderId, live, "stale_quote");
  }

  try {
    const pay = await stripeCards.chargeOffSession({
      user,
      card,
      amountCents: live,
      statement: `CardBed fill ${product.sku}`,
    });

    const copy = await grok.draftAlarmCopy({ product, order, quoteCents: live, kind: "fill" });

    store.mutate((d) => {
      const o = d.orders.find((x) => x.id === orderId);
      const u = d.users.find((x) => x.id === user.id);
      o.status = "filled";
      o.filledAt = store.now();
      o.fillCents = live;
      o.payment = pay;
      o.lastSignalCents = live;
      o.lastSignalKind = "fill";
      u.monthlyAutoBuySpentCents += live;
      d.alarms.unshift({
        id: store.uuid(),
        userId: user.id,
        orderId: o.id,
        productId: product.id,
        kind: "fill",
        status: "ringing",
        quoteCents: live,
        message: copy,
        createdAt: store.now(),
        snoozeUntil: null,
      });
      d.events.unshift({
        id: store.uuid(),
        type: "fill",
        message: `${product.name} FILLED at $${(live / 100).toFixed(2)} on •${card.last4}. Card tucked back in.`,
        createdAt: store.now(),
      });
    });

    return { ok: true, kind: "fill", orderId, quoteCents: live, payment: pay };
  } catch (err) {
    return raiseAlarm(orderId, quoteCents, "charge_failed", err.message);
  }
}

async function raiseAlarm(orderId, quoteCents, kind, extra = "") {
  const db = store.load();
  const order = db.orders.find((o) => o.id === orderId);
  const product = db.products.find((p) => p.id === order.productId);
  const copy =
    (await grok.draftAlarmCopy({ product, order, quoteCents, kind })) + (extra ? ` (${extra})` : "");

  const existing = db.alarms.find(
    (a) => a.orderId === orderId && a.status === "ringing" && a.kind !== "fill"
  );

  store.mutate((d) => {
    const o = d.orders.find((x) => x.id === orderId);
    o.lastSignalCents = quoteCents;
    o.lastSignalKind = kind;
    if (existing) {
      const a = d.alarms.find((x) => x.id === existing.id);
      a.quoteCents = quoteCents;
      a.kind = kind;
      a.message = copy;
      a.updatedAt = store.now();
      return;
    }
    d.alarms.unshift({
      id: store.uuid(),
      userId: order.userId,
      orderId: order.id,
      productId: product.id,
      kind,
      status: "ringing",
      quoteCents,
      message: copy,
      createdAt: store.now(),
      snoozeUntil: null,
    });
    d.events.unshift({
      id: store.uuid(),
      type: "alarm",
      message: `Alarm: ${product.name} at $${(quoteCents / 100).toFixed(2)} — ${kind}`,
      createdAt: store.now(),
    });
  });

  return { ok: true, kind, orderId, quoteCents, alarm: true };
}

async function answerAlarm(alarmId, answer) {
  const db = store.load();
  const alarm = db.alarms.find((a) => a.id === alarmId);
  if (!alarm) throw new Error("Alarm not found");
  const order = db.orders.find((o) => o.id === alarm.orderId);

  if (answer === "snooze") {
    store.mutate((d) => {
      const a = d.alarms.find((x) => x.id === alarmId);
      a.status = "snoozed";
      a.snoozeUntil = new Date(Date.now() + 3 * 86400000).toISOString();
    });
    return { status: "snoozed" };
  }

  if (answer === "no" || answer === "cancel") {
    store.mutate((d) => {
      const a = d.alarms.find((x) => x.id === alarmId);
      a.status = "dismissed";
      if (answer === "cancel") {
        const o = d.orders.find((x) => x.id === alarm.orderId);
        if (o && o.status === "working") o.status = "canceled";
      }
    });
    return { status: "dismissed" };
  }

  if (answer === "yes" || answer === "buy") {
    if (order.status !== "working") throw new Error("Order is no longer working");
    const product = db.products.find((p) => p.id === order.productId);
    const live = allIn(product);
    store.mutate((d) => {
      const o = d.orders.find((x) => x.id === order.id);
      o.limitCents = live;
      o.bandCents = 0;
      o.type = "limit";
    });
    const fill = await tryFill(order.id, live);
    store.mutate((d) => {
      const a = d.alarms.find((x) => x.id === alarmId);
      a.status = fill.ok && fill.kind === "fill" ? "accepted" : "failed";
    });
    return fill;
  }

  if (answer === "tighten") {
    const nextLimit = Math.max(50, alarm.quoteCents - order.bandCents);
    store.mutate((d) => {
      const o = d.orders.find((x) => x.id === order.id);
      o.limitCents = nextLimit;
      const a = d.alarms.find((x) => x.id === alarmId);
      a.status = "tightened";
    });
    return { status: "tightened", limitCents: nextLimit };
  }

  throw new Error("Unknown answer");
}

function tickMarket() {
  store.mutate((db) => {
    for (const product of db.products) jitterProduct(product);
  });
}

module.exports = {
  allIn,
  bands,
  classifyQuote,
  evaluateOpenOrders,
  tryFill,
  raiseAlarm,
  answerAlarm,
  tickMarket,
};
