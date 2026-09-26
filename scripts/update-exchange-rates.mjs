#!/usr/bin/env node
// ============================================================
// update-exchange-rates.mjs — today's exchange rates into Supabase
//
// Run every day by the GitHub Action "Exchange rates"
// (.github/workflows/exchange-rates.yml). It reads free rates that include
// the Nigerian naira and the Ghanaian cedi, and saves them with
// wearvia_save_exchange_rates (supabase/worldwide.sql), which only the
// SECRET key may call. The rates are "units per US dollar".
//
//   1. open.er-api.com (ExchangeRate-API's free, no-key feed; updated daily)
//   2. fawazahmed0/currency-api (free, no key) — fills any currency the
//      first one doesn't have, and is used on its own if the first is down
//
// Settings (environment variables):
//   SUPABASE_SECRET_KEY  the project's secret key (GitHub → Settings → Secrets
//                        and variables → Actions → New repository secret).
//                        Never put it in the app or in this file.
//   SUPABASE_URL         optional (default: wearvia/js/config.js)
//   DRY_RUN=1            fetch and print, save nothing
//   RATES_FILE=path      read rates from a file instead of the internet
//                        (for testing: {"date": "2026-09-25", "rates": {"USD": 1, …}})
// ============================================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = fs.readFileSync(path.join(ROOT, "wearvia", "js", "config.js"), "utf8");
const SUPABASE_URL = (process.env.SUPABASE_URL || (config.match(/SUPABASE_URL\s*=\s*"([^"]+)"/) || [])[1] || "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const DRY_RUN = process.env.DRY_RUN === "1";
const MUST_HAVE = ["USD", "GBP", "NGN", "GHS", "EUR", "CAD", "ZAR", "KES"];

async function getJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

// { date: "YYYY-MM-DD", rates: { USD: 1, GBP: 0.74, … }, source }
async function fromOpenErApi() {
  const data = await getJson("https://open.er-api.com/v6/latest/USD");
  if (data.result !== "success" || !data.rates || data.base_code !== "USD") throw new Error("unexpected answer");
  const date = new Date((data.time_last_update_unix || Date.now() / 1000) * 1000).toISOString().slice(0, 10);
  return { date, rates: upper(data.rates), source: "open.er-api.com" };
}

async function fromCurrencyApi() {
  const urls = ["https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json",
                "https://latest.currency-api.pages.dev/v1/currencies/usd.min.json"];
  let lastError;
  for (const url of urls) {
    try {
      const data = await getJson(url);
      if (!data.usd || !data.date) throw new Error("unexpected answer");
      return { date: data.date, rates: upper(data.usd), source: "fawazahmed0/currency-api" };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

// Only real three-letter currency codes, as positive numbers
function upper(rates) {
  const out = {};
  for (const [code, value] of Object.entries(rates || {})) {
    const c = code.toUpperCase();
    const n = Number(value);
    if (/^[A-Z]{3}$/.test(c) && Number.isFinite(n) && n > 0) out[c] = n;
  }
  return out;
}

async function loadRates() {
  if (process.env.RATES_FILE) {
    const data = JSON.parse(fs.readFileSync(process.env.RATES_FILE, "utf8"));
    return { date: data.date, rates: upper(data.rates), source: data.source || "file" };
  }
  const [first, second] = await Promise.allSettled([fromOpenErApi(), fromCurrencyApi()]);
  if (first.status === "rejected") console.warn("open.er-api.com:", first.reason.message);
  if (second.status === "rejected") console.warn("currency-api:", second.reason.message);
  const main = first.status === "fulfilled" ? first.value : second.status === "fulfilled" ? second.value : null;
  if (!main) throw new Error("Couldn't read exchange rates from either source.");
  const extra = first.status === "fulfilled" && second.status === "fulfilled" ? second.value : null;
  const rates = Object.assign({}, extra ? extra.rates : {}, main.rates);   // the main source wins
  const filled = extra ? Object.keys(extra.rates).filter(c => !(c in main.rates)).length : 0;
  return { date: main.date, rates, source: main.source + (filled ? ` + ${extra.source} (${filled})` : "") };
}

async function save({ date, rates, source }) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/wearvia_save_exchange_rates`, {
    method: "POST",
    headers: Object.assign({ apikey: KEY, "Content-Type": "application/json", Accept: "application/json" },
      // A legacy service_role key is a JWT and also goes in Authorization; new sb_secret_ keys only in apikey
      /^eyJ/.test(KEY) ? { Authorization: `Bearer ${KEY}` } : {}),
    body: JSON.stringify({ p_rates: rates, p_date: date, p_source: source })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase said ${response.status}: ${text}`);
  return JSON.parse(text);
}

try {
  const found = await loadRates();
  found.rates.USD = 1;
  const missing = MUST_HAVE.filter(c => !(c in found.rates));
  if (missing.length) throw new Error(`The rates are missing ${missing.join(", ")}.`);
  const show = c => `${c} ${found.rates[c]}`;
  console.log(`Rates for ${found.date} from ${found.source}: ${Object.keys(found.rates).length} currencies (${MUST_HAVE.map(show).join(", ")} per US dollar)`);
  if (DRY_RUN) {
    console.log("DRY_RUN=1: nothing saved.");
  } else {
    if (!SUPABASE_URL) throw new Error("SUPABASE_URL isn't set.");
    if (!KEY) throw new Error("SUPABASE_SECRET_KEY isn't set. Add it under GitHub → Settings → Secrets and variables → Actions.");
    if (/^sb_publishable_/.test(KEY)) throw new Error("That's the publishable key. The exchange rates need the SECRET key.");
    console.log(await save(found));
  }
} catch (error) {
  console.error("Exchange rates not updated:", error.message);
  process.exit(1);
}
