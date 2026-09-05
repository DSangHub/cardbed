const config = require("../config");
const store = require("../store");

const DEMO = !config.stripe.secret;

function mode() {
  return DEMO ? "demo" : "stripe";
}

async function stripeForm(pathname, params) {
  const body = new URLSearchParams(params);
  const res = await fetch(`https://api.stripe.com/v1/${pathname}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.stripe.secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}

async function ensureCustomer(user) {
  if (DEMO) {
    if (!user.stripeCustomerId) user.stripeCustomerId = `cus_demo_${user.id}`;
    return user.stripeCustomerId;
  }
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const customer = await stripeForm("customers", {
    email: user.email,
    "metadata[cardbedUserId]": user.id,
  });
  user.stripeCustomerId = customer.id;
  return customer.id;
}

async function createSetupIntent(user) {
  await ensureCustomer(user);
  if (DEMO) {
    return {
      mode: "demo",
      clientSecret: "seti_demo_secret",
      publishableKey: null,
      message: "Demo mode — POST /api/cards/demo to vault a test card.",
    };
  }
  const intent = await stripeForm("setup_intents", {
    customer: user.stripeCustomerId,
    "payment_method_types[0]": "card",
    usage: "off_session",
    "metadata[cardbedUserId]": user.id,
  });
  return {
    mode: "stripe",
    clientSecret: intent.client_secret,
    publishableKey: config.stripe.publishable,
  };
}

async function attachDemoCard(user, { brand = "visa", last4 = "4242", nickname = "Everyday" } = {}) {
  await ensureCustomer(user);
  return {
    id: `card_${store.uuid()}`,
    userId: user.id,
    nickname,
    brand,
    last4,
    expMonth: 12,
    expYear: new Date().getFullYear() + 3,
    stripePaymentMethodId: DEMO ? `pm_demo_${last4}` : null,
    status: "awake",
    sleep: {
      enabled: false,
      bedtime: "22:00",
      wakeTime: "07:00",
      timezone: "America/Los_Angeles",
      allowAutoBuyWhileAsleep: true,
      locationLock: "home",
    },
    snoozeUntil: null,
    createdAt: store.now(),
  };
}

async function attachStripePaymentMethod(user, paymentMethodId, nickname) {
  if (DEMO) throw new Error("Stripe keys not configured");
  await ensureCustomer(user);
  await stripeForm(`payment_methods/${paymentMethodId}/attach`, {
    customer: user.stripeCustomerId,
  });
  const pmRes = await fetch(`https://api.stripe.com/v1/payment_methods/${paymentMethodId}`, {
    headers: { Authorization: `Bearer ${config.stripe.secret}` },
  });
  const pm = await pmRes.json();
  return {
    id: `card_${store.uuid()}`,
    userId: user.id,
    nickname: nickname || `${pm.card.brand} • ${pm.card.last4}`,
    brand: pm.card.brand,
    last4: pm.card.last4,
    expMonth: pm.card.exp_month,
    expYear: pm.card.exp_year,
    stripePaymentMethodId: pm.id,
    status: "awake",
    sleep: {
      enabled: false,
      bedtime: "22:00",
      wakeTime: "07:00",
      timezone: "America/Los_Angeles",
      allowAutoBuyWhileAsleep: true,
      locationLock: "home",
    },
    snoozeUntil: null,
    createdAt: store.now(),
  };
}

async function chargeOffSession({ user, card, amountCents, currency = "usd", statement }) {
  if (card.status === "asleep" && !card.sleep?.allowAutoBuyWhileAsleep) {
    const err = new Error("Card is asleep and auto-buy while asleep is off");
    err.code = "CARD_ASLEEP";
    throw err;
  }
  if (DEMO) {
    return {
      ok: true,
      mode: "demo",
      paymentIntentId: `pi_demo_${store.uuid()}`,
      amountCents,
      last4: card.last4,
      status: "succeeded",
    };
  }
  const intent = await stripeForm("payment_intents", {
    amount: String(amountCents),
    currency,
    customer: user.stripeCustomerId,
    payment_method: card.stripePaymentMethodId,
    off_session: "true",
    confirm: "true",
    description: statement,
    "metadata[cardbedUserId]": user.id,
    "metadata[cardbedCardId]": card.id,
  });
  return {
    ok: intent.status === "succeeded",
    mode: "stripe",
    paymentIntentId: intent.id,
    amountCents,
    last4: card.last4,
    status: intent.status,
  };
}

module.exports = {
  mode,
  ensureCustomer,
  createSetupIntent,
  attachDemoCard,
  attachStripePaymentMethod,
  chargeOffSession,
};
