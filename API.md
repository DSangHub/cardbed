# CardBed backend APIs

Base URL: `http://localhost:3000/api`

JSON in, JSON out. No auth in demo mode (single seeded user). CORS is open for local UI work.

## Boot

```bash
cd cardbed
cp .env.example .env
node src/server.js
```

| Env | Empty means | Live means |
|---|---|---|
| `XAI_API_KEY` | Local limit analyst | Grok `POST /v1/chat/completions` |
| `STRIPE_SECRET_KEY` | Demo vault + fake PaymentIntents | SetupIntent + off-session charge |
| `STRIPE_WEBHOOK_SECRET` | Webhook accepted without verify | Verify when you wire Stripe CLI |

`GET /api/health` reports `stripe: demo|stripe` and `grok: local_fallback|live`.

## Catalog

`GET /api` lists every route. Resource GETs:

- `GET /api/cards`
- `GET /api/products`
- `GET /api/orders`
- `GET /api/alarms`
- `GET /api/state` — full bedside snapshot the UI polls

## Cards

```bash
curl -X POST http://localhost:3000/api/cards/demo \
  -H 'Content-Type: application/json' \
  -d '{"nickname":"Nightstand","brand":"visa","last4":"4242"}'

curl -X POST http://localhost:3000/api/cards/CARD_ID/sleep \
  -H 'Content-Type: application/json' \
  -d '{"mode":"sleep","bedtime":"22:00","wakeTime":"07:00"}'
```

`mode`: `sleep` | `wake` | `snooze` (`minutes` default 30).

Live Stripe:

1. `POST /api/cards/setup-intent`
2. Confirm with Stripe.js
3. `POST /api/cards/attach` `{ "paymentMethodId":"pm_...","nickname":"Travel" }`

## Limits (stock comparison)

```bash
curl -X POST http://localhost:3000/api/products/prod_anker/analyze

curl -X POST http://localhost:3000/api/orders \
  -H 'Content-Type: application/json' \
  -d '{"productId":"prod_anker","cardId":"CARD_ID","type":"limit","limitCents":1500,"bandCents":200}'
```

- print ≤ limit+band → auto-buy (Stripe off-session, demo `pi_demo_*`)
- print in the nudge zone → alarm `yes|no|tighten|snooze|cancel`
- `type: alert_only` never auto-buys

## Scan

```bash
curl -X POST http://localhost:3000/api/scan \
  -H 'Content-Type: application/json' \
  -d '{"barcode":"847447000424","arm":"alert_only","cardId":"CARD_ID"}'
```

Demo UPCs: `GET /api/scan/demo-codes`

## Simulate a print

```bash
curl -X POST http://localhost:3000/api/sim/drop/prod_anker \
  -H 'Content-Type: application/json' \
  -d '{"cents":1499}'
```

## Stripe webhook

`POST /api/webhooks/stripe` — records the event type on the ledger. Point Stripe CLI here when keys are live.
