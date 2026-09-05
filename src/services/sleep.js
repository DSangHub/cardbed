const store = require("../store");

function parseHHMM(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
}

function minutesNow(timezone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone || "America/Los_Angeles",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function inBedWindow(card, tzNow = null) {
  if (!card.sleep?.enabled) return false;
  const nowMin = tzNow ?? minutesNow(card.sleep.timezone);
  const bed = parseHHMM(card.sleep.bedtime);
  const wake = parseHHMM(card.sleep.wakeTime);
  if (bed === wake) return true;
  if (bed < wake) return nowMin >= bed && nowMin < wake;
  return nowMin >= bed || nowMin < wake;
}

function applySchedule(card) {
  const snoozed = card.snoozeUntil && Date.parse(card.snoozeUntil) > Date.now();
  if (snoozed) {
    card.status = "snoozed";
    return card.status;
  }
  if (card.snoozeUntil && Date.parse(card.snoozeUntil) <= Date.now()) {
    card.snoozeUntil = null;
  }
  if (inBedWindow(card)) card.status = "asleep";
  else if (card.sleep?.enabled) card.status = "awake";
  return card.status;
}

function sleepNow(card) {
  card.sleep = card.sleep || {};
  card.sleep.enabled = true;
  card.snoozeUntil = null;
  card.status = "asleep";
  return card;
}

function wakeNow(card) {
  card.sleep = card.sleep || {};
  card.sleep.enabled = false;
  card.snoozeUntil = null;
  card.status = "awake";
  return card;
}

function snooze(card, minutes = 30) {
  card.snoozeUntil = new Date(Date.now() + minutes * 60 * 1000).toISOString();
  card.status = "snoozed";
  return card;
}

function canCharge(card, { isAutoBuy = false } = {}) {
  applySchedule(card);
  if (card.status === "awake") return { ok: true, reason: "awake" };
  if (card.status === "snoozed") {
    return { ok: false, reason: "Card is snoozing until alarms resume", code: "SNOOZED" };
  }
  if (card.status === "asleep") {
    if (isAutoBuy && card.sleep?.allowAutoBuyWhileAsleep) {
      return { ok: true, reason: "preauthorized_fill_while_asleep" };
    }
    return { ok: false, reason: "Card is asleep", code: "ASLEEP" };
  }
  return { ok: false, reason: "unknown", code: "LOCKED" };
}

function tickAll() {
  store.mutate((db) => {
    for (const card of db.cards) applySchedule(card);
  });
}

module.exports = {
  inBedWindow,
  applySchedule,
  sleepNow,
  wakeNow,
  snooze,
  canCharge,
  tickAll,
};
