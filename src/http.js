const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PUBLIC = path.join(__dirname, "..", "public");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function send(res, status, data, headers = {}) {
  const body = typeof data === "string" ? data : JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": typeof data === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    ...headers,
  });
  res.end(body);
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, buf) => {
    if (err) return send(res, 404, { error: "Not found" });
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(buf);
  });
}

function staticPath(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  if (clean === "/" ) return path.join(PUBLIC, "index.html");
  const resolved = path.normalize(path.join(PUBLIC, clean));
  if (!resolved.startsWith(PUBLIC)) return null;
  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;
  return path.join(PUBLIC, "index.html");
}

module.exports = { readBody, send, sendFile, staticPath, URL };
