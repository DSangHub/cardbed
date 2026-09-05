const $ = (id) => document.getElementById(id);
let state = null;
let pendingThesis = null;

async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function money(cents) {
  return `$${((cents || 0) / 100).toFixed(2)}`;
}

async function refresh() {
  state = await api("/state");
  const health = await api("/health");
  $("health").innerHTML = `
    <span class="pill">Stripe ${health.stripe}</span>
    <span class="pill">Grok ${health.grok}</span>
    <span class="pill">cap ${money(state.user.monthlyAutoBuyCapCents)}</span>
  `;
  renderAlarms();
  renderCards();
  renderProducts();
  renderOrders();
  renderEvents();
}

function renderAlarms() {
  const ringing = (state.alarms || []).filter((a) => a.status === "ringing");
  $("alarms").innerHTML = ringing
    .map(
      (a) => `
      <div class="alarm">
        <div class="meta">${a.kind.toUpperCase()} · ${a.product?.name || a.productId}</div>
        <h3>${money(a.quoteCents)}</h3>
        <p>${a.message}</p>
        <div class="actions">
          <button class="yes" data-alarm="${a.id}" data-ans="yes">Buy Y</button>
          <button class="no" data-alarm="${a.id}" data-ans="no">No</button>
          <button data-alarm="${a.id}" data-ans="tighten">Tighten limit</button>
          <button data-alarm="${a.id}" data-ans="snooze">Snooze 3 days</button>
          <button data-alarm="${a.id}" data-ans="cancel">Cancel order</button>
        </div>
      </div>`
    )
    .join("");
}

function renderCards() {
  if (!state.cards.length) {
    $("cards").innerHTML = `<div class="card"><p>No cards in the bed yet.</p></div>`;
    return;
  }
  $("cards").innerHTML = state.cards
    .map(
      (c) => `
      <div class="card">
        <h3>${c.nickname}</h3>
        <div class="meta">${c.brand} •${c.last4} · ${String(c.expMonth).padStart(2, "0")}/${c.expYear}</div>
        <div class="status ${c.status}">${c.status}</div>
        <div class="meta">Bed ${c.sleep?.bedtime || "—"} → ${c.sleep?.wakeTime || "—"}
          · auto-fill while asleep ${c.sleep?.allowAutoBuyWhileAsleep ? "on" : "off"}</div>
        <div class="actions">
          <button data-card="${c.id}" data-mode="sleep">Sleep</button>
          <button data-card="${c.id}" data-mode="wake">Wake</button>
          <button data-card="${c.id}" data-mode="snooze">Snooze 30m</button>
        </div>
      </div>`
    )
    .join("");
}

function renderProducts() {
  $("products").innerHTML = state.products
    .map((p) => {
      const s = p.stats || {};
      return `
        <div class="prod">
          <div class="meta">${p.image} ${p.merchant} · ${p.sku}</div>
          <h3>${p.name}</h3>
          <div class="price">${money(p.currentCents)}</div>
          <div class="spark">${p.barcode ? "UPC " + p.barcode + " · " : ""}All-in ${money(p.allInCents)} · 90d ${money(s.low90)}–${money(s.high90)} · −${s.dropFromHighPct}% from high</div>
          <div class="actions">
            <button data-analyze="${p.id}">Grok limit</button>
            <button class="ghost" data-dump="${p.id}">Force dip</button>
          </div>
        </div>`;
    })
    .join("");
}

function renderOrders() {
  const rows = state.orders || [];
  if (!rows.length) {
    $("orders").innerHTML = `<div class="ord meta">No working limits. Analyze an item, then place $15 ± $2.</div>`;
    return;
  }
  $("orders").innerHTML = rows
    .map(
      (o) => `
      <div class="ord">
        <strong>${o.product?.name || o.productId}</strong>
        <div class="meta">${o.status} · ${o.type} · limit ${money(o.limitCents)} ± ${money(o.bandCents)}
          · fill ≤ ${money(o.fillCeilingCents)} · nudge ≤ ${money(o.nudgeCeilingCents)}
          · card •${o.card?.last4 || "—"}</div>
        ${o.status === "working" ? `<div class="actions"><button data-cancel="${o.id}">Cancel</button></div>` : ""}
        ${o.fillCents ? `<div class="meta">Filled ${money(o.fillCents)} · ${o.payment?.paymentIntentId || ""}</div>` : ""}
      </div>`
    )
    .join("");
}

function renderEvents() {
  $("events").innerHTML = (state.events || [])
    .map((e) => `<div>${e.createdAt?.slice(11, 19) || ""} — ${e.message}</div>`)
    .join("");
}

$("addCard").onclick = async () => {
  const last4 = String(Math.floor(1000 + Math.random() * 9000));
  await api("/cards/demo", {
    method: "POST",
    body: { nickname: "Bedside card", brand: "visa", last4 },
  });
  await refresh();
};

$("tick").onclick = async () => {
  await api("/sim/tick", { method: "POST" });
  await refresh();
};

let scanStream = null;
let scanTimer = null;

async function openScanner() {
  $("scanCard").innerHTML = (state.cards || [])
    .map((c) => `<option value="${c.id}">${c.nickname} •${c.last4}</option>`)
    .join("");
  const demo = await api("/scan/demo-codes");
  $("scanHints").textContent =
    "Demo UPCs: " + Object.keys(demo.codes).join("  ·  ") + "  (headphones, Airwrap, LEGO, kettle)";
  $("scanStatus").textContent = "Camera idle — open camera, drop a photo, or type a UPC.";
  $("scanModal").showModal();
}

async function startCamera() {
  stopCamera();
  if (!navigator.mediaDevices?.getUserMedia) {
    $("scanStatus").textContent = "No camera API. Use Photo or type the UPC.";
    return;
  }
  scanStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" } },
    audio: false,
  });
  const video = $("scanVideo");
  video.srcObject = scanStream;
  await video.play();
  $("scanStatus").textContent = "Live — hold a barcode in the box.";
  scanTimer = setInterval(scanLiveFrame, 400);
}

function stopCamera() {
  if (scanTimer) clearInterval(scanTimer);
  scanTimer = null;
  if (scanStream) {
    scanStream.getTracks().forEach((t) => t.stop());
    scanStream = null;
  }
  const video = $("scanVideo");
  if (video) video.srcObject = null;
}

async function detectFromImage(source) {
  if (window.BarcodeDetector) {
    const detector = new BarcodeDetector({
      formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "qr_code"],
    });
    const codes = await detector.detect(source);
    if (codes[0]?.rawValue) return codes[0].rawValue;
  }
  if (window.ZXing) {
    const reader = new ZXing.BrowserMultiFormatReader();
    try {
      const result = await reader.decodeFromImageElement(source);
      if (result?.text) return result.text;
    } catch {
      /* no code in frame */
    }
  }
  return null;
}

async function scanLiveFrame() {
  const video = $("scanVideo");
  if (!video.videoWidth) return;
  const canvas = $("scanCanvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  const code = await detectFromImage(canvas);
  if (code) {
    $("scanManual").value = String(code).replace(/\D/g, "");
    $("scanStatus").textContent = "Got " + code;
    stopCamera();
    await submitScan();
  }
}

async function loadZXing() {
  if (window.ZXing || window.BarcodeDetector) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://unpkg.com/@zxing/library@0.20.0/umd/index.min.js";
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function submitScan() {
  const code = $("scanManual").value.trim();
  if (!code) throw new Error("Scan or type a barcode first");
  $("scanStatus").textContent = "Looking up " + code + "…";
  const out = await api("/scan", {
    method: "POST",
    body: {
      barcode: code,
      arm: $("scanArm").value || undefined,
      cardId: $("scanCard").value || undefined,
    },
  });
  $("scanStatus").textContent =
    (out.created ? "New item · " : "Known item · ") +
    out.product.name +
    (out.order ? " · alarm armed" : "");
  stopCamera();
  $("scanModal").close();
  await refresh();
  if (!out.order) openOrder(out);
}

$("scanBtn").onclick = () => openScanner().catch((err) => alert(err.message));
$("scanLive").onclick = () => startCamera().catch((err) => {
  $("scanStatus").textContent = err.message + " — use Photo instead.";
});
$("scanSnap").onclick = async () => {
  try {
    const video = $("scanVideo");
    if (!video.videoWidth) return;
    const canvas = $("scanCanvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    const code = await detectFromImage(canvas);
    if (!code) {
      $("scanStatus").textContent = "No barcode in that frame. Try closer, or type it.";
      return;
    }
    $("scanManual").value = String(code).replace(/\D/g, "");
    await submitScan();
  } catch (err) {
    $("scanStatus").textContent = err.message;
  }
};
$("scanFile").onchange = async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    await loadZXing();
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      const code = await detectFromImage(img);
      URL.revokeObjectURL(url);
      if (!code) {
        $("scanStatus").textContent = "Could not read a barcode from that photo. Type the UPC.";
        return;
      }
      $("scanManual").value = String(code).replace(/\D/g, "");
      $("scanStatus").textContent = "Photo → " + code;
      await submitScan();
    };
    img.src = url;
  } catch (err) {
    $("scanStatus").textContent = err.message;
  }
};
$("scanLookup").onclick = () => submitScan().catch((err) => {
  $("scanStatus").textContent = err.message;
});
$("scanClose").onclick = () => {
  stopCamera();
  $("scanModal").close();
};
$("scanModal").addEventListener("close", stopCamera);

$("cancelOrder").onclick = () => $("orderModal").close();

document.body.addEventListener("click", async (e) => {
  const t = e.target;
  try {
    if (t.dataset.card) {
      await api(`/cards/${t.dataset.card}/sleep`, {
        method: "POST",
        body: { mode: t.dataset.mode, minutes: 30, bedtime: "22:00", wakeTime: "07:00" },
      });
      await refresh();
    }
    if (t.dataset.analyze) {
      const out = await api(`/products/${t.dataset.analyze}/analyze`, { method: "POST" });
      openOrder(out);
    }
    if (t.dataset.dump) {
      const p = state.products.find((x) => x.id === t.dataset.dump);
      const dip = Math.round(p.currentCents * 0.72);
      await api(`/sim/drop/${p.id}`, { method: "POST", body: { cents: dip } });
      await refresh();
    }
    if (t.dataset.cancel) {
      await api(`/orders/${t.dataset.cancel}/cancel`, { method: "POST" });
      await refresh();
    }
    if (t.dataset.alarm) {
      await api(`/alarms/${t.dataset.alarm}/answer`, {
        method: "POST",
        body: { answer: t.dataset.ans },
      });
      await refresh();
    }
  } catch (err) {
    alert(err.message);
  }
});

function openOrder(out) {
  pendingThesis = out;
  const p = out.product;
  const th = out.thesis;
  $("orderTitle").textContent = `Limit · ${p.name}`;
  $("orderThesis").textContent = `${th.thesis}  [${th.source}${th.model ? " / " + th.model : ""}]`;
  $("orderHint").textContent = `Fill at or below ${money(th.fillCeilingCents)}. Near-miss alarms up to ${money(th.nudgeCeilingCents)}.`;
  const form = $("orderForm");
  form.productId.value = p.id;
  form.limit.value = (th.suggestedLimitCents / 100).toFixed(2);
  form.band.value = (th.suggestedBandCents / 100).toFixed(2);
  const sel = form.cardId;
  sel.innerHTML = state.cards
    .map((c) => `<option value="${c.id}">${c.nickname} •${c.last4} (${c.status})</option>`)
    .join("");
  if (!state.cards.length) {
    alert("Tuck a card in first.");
    return;
  }
  $("orderModal").showModal();
}

$("orderForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  try {
    await api("/orders", {
      method: "POST",
      body: {
        productId: form.productId.value,
        cardId: form.cardId.value,
        type: form.type.value,
        limitCents: Math.round(Number(form.limit.value) * 100),
        bandCents: Math.round(Number(form.band.value) * 100),
        expiresInDays: 90,
      },
    });
    $("orderModal").close();
    await refresh();
  } catch (err) {
    alert(err.message);
  }
});

refresh().catch((err) => {
  $("events").textContent = err.message;
});
setInterval(refresh, 8000);
