const http = require("http");
const config = require("./config");
const store = require("./store");
const sleep = require("./services/sleep");
const market = require("./services/market");
const { readBody, send, sendFile, staticPath } = require("./http");
const handleApi = require("./routes/api");

store.seedIfEmpty();
require("./services/barcode").stampDemoBarcodes();

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    });
    return res.end();
  }

  try {
    const url = new URL(req.url, config.appUrl);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      const body = req.method === "POST" ? await readBody(req) : {};
      await handleApi(req, res, url, body);
      return;
    }
    const file = staticPath(url.pathname);
    if (!file) return send(res, 404, { error: "Not found" });
    sendFile(res, file);
  } catch (err) {
    send(res, 500, { error: err.message });
  }
});

setInterval(() => sleep.tickAll(), 30_000);
setInterval(async () => {
  try {
    market.tickMarket();
    await market.evaluateOpenOrders();
  } catch (err) {
    console.error("market tick", err.message);
  }
}, 12_000);

server.listen(config.port, () => {
  console.log(`CardBed listening on ${config.appUrl}`);
  console.log(`Stripe: ${require("./services/stripeCards").mode()}`);
  console.log(`Grok: ${config.xai.apiKey ? config.xai.model : "local fallback (set XAI_API_KEY)"}`);
});
