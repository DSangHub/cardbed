const store = require("../store");

const DEMO_UPCS = {
  "847447000424": "prod_anker",
  "885909950805": "prod_air",
  "673419311409": "prod_lego",
  "851141006113": "prod_kettle",
};

const DEMO_META = {
  prod_anker: "847447000424",
  prod_air: "885909950805",
  prod_lego: "673419311409",
  prod_kettle: "851141006113",
};

function normalize(code) {
  return String(code || "").replace(/\D/g, "");
}

function stampDemoBarcodes() {
  store.mutate((db) => {
    for (const p of db.products) {
      if (!p.barcode && DEMO_META[p.id]) p.barcode = DEMO_META[p.id];
    }
  });
}

function findByBarcode(code) {
  const barcode = normalize(code);
  if (!barcode) return null;
  const db = store.load();
  const mapped = DEMO_UPCS[barcode];
  return (
    db.products.find((p) => normalize(p.barcode) === barcode) ||
    db.products.find((p) => p.id === mapped) ||
    db.products.find((p) => normalize(p.sku) === barcode) ||
    null
  );
}

async function lookupRemote(barcode) {
  const off = await lookupOpenFoodFacts(barcode);
  if (off) return off;
  return lookupUpcItemDb(barcode);
}

async function lookupOpenFoodFacts(barcode) {
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${barcode}.json`,
      { headers: { "User-Agent": "CardBed/1.0 (cardbed.com)" } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 1 || !data.product) return null;
    const p = data.product;
    const name = p.product_name || p.generic_name || p.brands || `UPC ${barcode}`;
    return {
      name: String(name).slice(0, 80),
      brand: p.brands || "Unknown brand",
      merchant: "Shelf / grocery",
      image: "📦",
      source: "openfoodfacts",
    };
  } catch {
    return null;
  }
}

async function lookupUpcItemDb(barcode) {
  try {
    const res = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${barcode}`);
    if (!res.ok) return null;
    const data = await res.json();
    const item = data.items && data.items[0];
    if (!item) return null;
    const cents = item.lowest_recorded_price
      ? Math.round(Number(item.lowest_recorded_price) * 100)
      : item.offer
        ? Math.round(Number(item.offer) * 100)
        : 999;
    return {
      name: item.title || `UPC ${barcode}`,
      brand: item.brand || "Unknown",
      merchant: (item.offers && item.offers[0] && item.offers[0].merchant) || "Marketplace",
      image: "📦",
      currentCents: cents > 0 ? cents : 999,
      source: "upcitemdb",
    };
  } catch {
    return null;
  }
}

function createFromScan(barcode, meta) {
  const currentCents = meta.currentCents || 1299;
  const product = {
    id: `prod_${store.uuid()}`,
    name: meta.name,
    sku: barcode,
    barcode,
    merchant: meta.merchant || "Scanned",
    image: meta.image || "📷",
    currency: "usd",
    currentCents,
    history: [
      { t: Date.now() - 86400000 * 30, cents: Math.round(currentCents * 1.12) },
      { t: Date.now(), cents: currentCents },
    ],
    taxRate: 0.0825,
    shippingCents: 0,
    condition: "new",
    trusted: Boolean(meta.source),
    scannedAt: store.now(),
    scanSource: meta.source || "manual",
  };
  store.mutate((db) => {
    db.products.unshift(product);
    db.events.unshift({
      id: store.uuid(),
      type: "scan",
      message: `Scanned ${product.barcode} → ${product.name}`,
      createdAt: store.now(),
    });
  });
  return product;
}

async function resolveBarcode(code) {
  stampDemoBarcodes();
  const barcode = normalize(code);
  if (barcode.length < 8) throw new Error("Need an 8–14 digit UPC / EAN");
  let product = findByBarcode(barcode);
  if (product) {
    if (!product.barcode) {
      store.mutate((db) => {
        const p = db.products.find((x) => x.id === product.id);
        if (p) p.barcode = barcode;
      });
      product = { ...product, barcode };
    }
    return { product, created: false, barcode };
  }
  const remote = await lookupRemote(barcode);
  const productNew = createFromScan(barcode, remote || {
    name: `Unknown item ${barcode}`,
    merchant: "Scanned shelf",
    image: "📷",
    currentCents: 999,
    source: "unknown",
  });
  return { product: productNew, created: true, barcode };
}

module.exports = { normalize, resolveBarcode, stampDemoBarcodes, DEMO_UPCS };
