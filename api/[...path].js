const store = require("../src/store");
const { readBody, send } = require("../src/http");
const handleApi = require("../src/routes/api");

function ensureSeeded() {
  store.seedIfEmpty();
  require("../src/services/barcode").stampDemoBarcodes();
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    });
    return res.end();
  }

  try {
    ensureSeeded();
    const host = req.headers.host || "localhost";
    const protocol = req.headers["x-forwarded-proto"] || "https";
    const url = new URL(req.url, `${protocol}://${host}`);
    const body = req.method === "POST" ? await readBody(req) : {};
    return await handleApi(req, res, url, body);
  } catch (err) {
    return send(res, 500, { error: err.message });
  }
};
