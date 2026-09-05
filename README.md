# CardBed

A bed for credit and debit cards. Cards sleep on a schedule. Saved items work like **stock limit orders**. If the print is inside your band, CardBed wakes the card, charges via Stripe, and tucks it back in. If the price only dips, an alarm asks **Y/N**.

## Quick start

Zero npm dependencies (Node 18+). Stripe and Grok use fetch.

```bash
cd cardbed
cp .env.example .env
node src/server.js
```

Open http://localhost:3000

## Photo + barcode

Scan a UPC to arm a price-drop alarm. Demo codes: `847447000424` Anker, `885909950805` Airwrap, `673419311409` LEGO, `851141006113` kettle.
