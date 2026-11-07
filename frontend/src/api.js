const TOKEN_KEY = "pp_token";

// "Remember me" keeps the token in localStorage; otherwise it lives only for this browser tab.
export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(t, remember = true) {
  try {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    if (t) (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, t);
  } catch { /* storage blocked */ }
}

/** Per-browser personal preferences (notification toggles, time zone, language, date format). */
const PREFS_KEY = "pp_prefs";
export const DEFAULT_PREFS = {
  warn_2_days: true, notify_delayed: true, email_new_task: true, daily_summary: false,
  time_zone: "Asia/Almaty", language: "en", date_format: "d MMM yyyy",
};
export function getPrefs() {
  let p;
  try { p = { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") }; } catch { p = { ...DEFAULT_PREFS }; }
  if (!["en", "ru", "kk"].includes(p.language)) p.language = "en";
  return p;
}
export function savePrefs(p) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* storage blocked */ }
}

export class ApiError extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data; }
}

export async function api(path, { method = "GET", body } = {}) {
  const headers = { Accept: "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Token ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`/api/${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  if (res.status === 204) return null;
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (res.status === 401) {
    setToken(null);
    window.dispatchEvent(new Event("pp:logout"));
  }
  if (!res.ok) throw new ApiError((data && data.detail) || `Request failed (${res.status})`, res.status, data);
  return data;
}

/* Dates follow the language chosen in Personal settings. */
const LOCALES = { en: "en-GB", ru: "ru-RU", kk: "kk-KZ" };
let locale = "en-GB";
let relWords = null;
export function setDateLocale(lang, rel) { locale = LOCALES[lang] || "en-GB"; relWords = rel; }

// Browsers often lack Kazakh month names, so Kazakh dates are formatted here.
const KK_MONTHS = ["қаңтар", "ақпан", "наурыз", "сәуір", "мамыр", "маусым", "шілде", "тамыз", "қыркүйек", "қазан", "қараша", "желтоқсан"];
const KK_SHORT = ["қаң.", "ақп.", "нау.", "сәу.", "мам.", "мау.", "шіл.", "там.", "қыр.", "қаз.", "қар.", "жел."];
const KK_DAYS = ["жексенбі", "дүйсенбі", "сейсенбі", "сәрсенбі", "бейсенбі", "жұма", "сенбі"];
function kkDate(d, opts) {
  const parts = [];
  if (opts.weekday) parts.push(KK_DAYS[d.getDay()] + ",");
  if (opts.year) parts.push(String(d.getFullYear()));
  parts.push(String(d.getDate()));
  parts.push(opts.month === "long" ? KK_MONTHS[d.getMonth()] : KK_SHORT[d.getMonth()]);
  return parts.join(" ");
}

export const fmtDate = (iso, opts = { day: "numeric", month: "short" }) => {
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  return locale === "kk-KZ" ? kkDate(d, opts) : d.toLocaleDateString(locale, opts);
};

export const fmtDateTime = (iso) => {
  const d = new Date(iso);
  if (locale === "kk-KZ") return `${kkDate(d, { month: "short" })}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return d.toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

export function relDays(days) {
  if (days === null || days === undefined) return "";
  const w = relWords || ((k, v) => ({ today: "today", tomorrow: "tomorrow", yesterday: "yesterday", in: `in ${v?.n} days`, ago: `${v?.n} days ago` }[k]));
  if (days === 0) return w("today");
  if (days === 1) return w("tomorrow");
  if (days === -1) return w("yesterday");
  return days > 0 ? w("in", { n: days }) : w("ago", { n: -days });
}
