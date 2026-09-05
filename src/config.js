const fs = require("fs");
const path = require("path");

function loadEnv() {
  const file = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnv();

module.exports = {
  port: Number(process.env.PORT || 3000),
  appUrl: process.env.APP_URL || "http://localhost:3000",
  xai: {
    apiKey: process.env.XAI_API_KEY || "",
    model: process.env.XAI_MODEL || "grok-4.6",
    baseUrl: process.env.XAI_BASE_URL || "https://api.x.ai/v1",
  },
  stripe: {
    secret: process.env.STRIPE_SECRET_KEY || "",
    publishable: process.env.STRIPE_PUBLISHABLE_KEY || "",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
  },
  demoEmail: process.env.DEMO_EMAIL || "you@cardbed.com",
};
