const fs = require("fs");
const path = require("path");
const os = require("os");
const { randomUUID } = require("crypto");
const uuid = () => randomUUID();

// Vercel functions have a read-only deployment filesystem. Use /tmp there so
// the demo can run without crashing; production persistence should use a DB.
const DATA_FILE = process.env.VERCEL
  ? path.join(os.tmpdir(), "cardbed-db.json")
  : path.join(__dirname, "..", "data", "db.json");

const empty = () => ({
  users: [],
  cards: [],
  products: [],
  orders: [],
  alarms: [],
  events: [],
});

function load() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(empty(), null, 2));
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function save(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function mutate(fn) {
  const db = load();
  const result = fn(db);
  save(db);
  return result;
}

function now() {
  return new Date().toISOString();
}

function seedIfEmpty() {
  mutate((db) => {
    if (db.products.length) return;
    db.users.push({
      id: "user_demo",
      email: "you@cardbed.com",
      stripeCustomerId: null,
      monthlyAutoBuyCapCents: 8000,
      monthlyAutoBuySpentCents: 0,
      createdAt: now(),
    });
    db.products.push(
      { id: "prod_anker", name: "Anker Soundcore Headphones", sku: "ANK-SC-Q30", merchant: "Amazon", image: "🎧", currency: "usd", currentCents: 2499, history: makeHistory(2499, 1749, 2999), taxRate: 0.0825, shippingCents: 0, condition: "new", trusted: true },
      { id: "prod_air", name: "Dyson Airwrap Complete", sku: "DYS-AW-C", merchant: "Best Buy", image: "💨", currency: "usd", currentCents: 45999, history: makeHistory(45999, 32999, 59999), taxRate: 0.0825, shippingCents: 0, condition: "new", trusted: true },
      { id: "prod_lego", name: "LEGO Millennium Falcon", sku: "LEG-75192", merchant: "Target", image: "🧱", currency: "usd", currentCents: 15999, history: makeHistory(15999, 12999, 16999), taxRate: 0.0825, shippingCents: 599, condition: "new", trusted: true },
      { id: "prod_kettle", name: "Fellow Stagg EKG Kettle", sku: "FEL-EKG", merchant: "Fellow", image: "🍵", currency: "usd", currentCents: 19500, history: makeHistory(19500, 14900, 19500), taxRate: 0.0825, shippingCents: 0, condition: "new", trusted: true }
    );
    db.events.push({ id: uuid(), type: "system", message: "CardBed ledger initialized.", createdAt: now() });
  });
}

function makeHistory(current, low, high) {
  const points = [];
  for (let i = 90; i >= 0; i--) {
    const t = Date.now() - i * 86400000;
    const wave = Math.sin(i / 9) * ((high - low) * 0.15);
    const drift = ((high - current) * i) / 90;
    let price = Math.round(current + drift + wave);
    price = Math.max(low, Math.min(high, price));
    points.push({ t, cents: price });
  }
  points[points.length - 1].cents = current;
  return points;
}

function stats(product) {
  const prices = product.history.map((h) => h.cents);
  const low90 = Math.min(...prices);
  const high90 = Math.max(...prices);
  return {
    low90,
    high90,
    current: product.currentCents,
    allIn: Math.round(product.currentCents * (1 + product.taxRate) + product.shippingCents),
    dropFromHighPct: high90 ? Math.round(((high90 - product.currentCents) / high90) * 1000) / 10 : 0,
  };
}

module.exports = { load, save, mutate, now, seedIfEmpty, uuid, stats };
