import { filterJobs, locationLabel, payLabel, roleNames, safeHttps, sourceNames } from "./jobs.mjs";
import { reviewCV } from "./cv-review.mjs";

const $ = (id) => document.getElementById(id);
const make = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (className) element.className = className;
  return element;
};
const prettyDate = new Intl.DateTimeFormat("en-IE", {
  dateStyle: "medium", timeZone: "Europe/Dublin",
});
const prettyTime = new Intl.DateTimeFormat("en-IE", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Dublin",
});
const settingsKey = `dublin-dental-jobs:${new URL("../", import.meta.url).pathname}`;
const settings = { alerts: false, seen: null };
let snapshot;
let fetching = false;
let lastCheck = 0;
let registration;

function readSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(settingsKey));
    if (typeof saved?.alerts === "boolean") settings.alerts = saved.alerts;
    if (Array.isArray(saved?.seen)) settings.seen = saved.seen.filter((id) => typeof id === "string");
  } catch {
    // Some browsers disable local storage. Preferences still work until reload.
  }
}

function saveSettings() {
  try {
    localStorage.setItem(settingsKey, JSON.stringify(settings));
  } catch {
    // The CV is never persisted, and alerts can still work for this visit.
  }
}

function jobFilters() {
  return Object.fromEntries(["keyword", "role", "county", "sort"].map((id) => [id, $(id).value]));
}

function renderJobs() {
  const filters = jobFilters();
  const location = filters.county ? `${filters.county}, Ireland` : "Ireland";
  const keywords = roleNames[filters.role] || "Dental";
  $("linkedin").href = `https://www.linkedin.com/jobs/search/?${new URLSearchParams({ keywords, location })}`;
  $("indeed").href = `https://ie.indeed.com/jobs?${new URLSearchParams({ q: keywords, l: location })}`;

  const results = filterJobs(snapshot?.jobs || [], filters);
  $("results-count").textContent = snapshot ? `${results.length} ${results.length === 1 ? "listing" : "listings"}` : "";
  if (!results.length) {
    const message = snapshot?.jobs.length
      ? "No listings match these filters. Try another role or county."
      : snapshot?.status === "ok"
        ? "No matching vacancies from the connected sources. Try the other job sites below."
        : "There are no verified listings to show right now. Use the job sites below to search directly.";
    $("job-results").replaceChildren(make("p", message, "notice"));
    return;
  }

  const list = make("ul", null, "job-list");
  list.setAttribute("role", "list");
  for (const job of results) {
    const row = make("li", null, "panel job-row");
    const title = make("div", null, "job-title");
    const viaJooble = job.source === "jooble";
    const attribution = viaJooble ? `${job.employer} · Via Jooble` : job.employer;
    title.append(make("span", roleNames[job.role], "pill"), make("h3", job.title), make("p", attribution));
    const details = make("div");
    const timestamp = Date.parse(job.publishedAt ?? job.updatedAt);
    const date = Number.isFinite(timestamp) ? `${job.publishedAt ? "Posted" : "Updated"} ${prettyDate.format(timestamp)}` : "";
    const distance = Number.isFinite(job.distanceKm) ? `${job.distanceKm.toFixed(1)} km from Sandyford` : "";
    details.append(make("p", locationLabel(job)), make("p", [distance, date].filter(Boolean).join(" · ")), make("p", payLabel(job.pay), "job-pay"));
    row.append(title, details);
    const url = safeHttps(job.url);
    if (url) {
      const apply = make("a", viaJooble ? "View on Jooble ↗" : "View & apply ↗", "button primary");
      apply.href = url;
      apply.setAttribute("aria-label", viaJooble
        ? `View ${job.title} on Jooble`
        : `View and apply for ${job.title} at ${job.employer} (opens original site)`);
      apply.target = "_blank";
      apply.rel = "noopener noreferrer";
      row.append(apply);
    }
    list.append(row);
  }
  $("job-results").replaceChildren(list);
}

const browserAlerts = () => window.isSecureContext && "Notification" in window
  && "serviceWorker" in navigator;

function renderAlerts(message) {
  const supported = browserAlerts();
  const allowed = supported && Notification.permission === "granted";
  $("alert-toggle").disabled = !supported || Notification.permission === "denied";
  $("alert-toggle").textContent = settings.alerts && allowed ? "Turn off browser alerts" : "Enable browser alerts";
  $("alert-status").textContent = message || (!supported
    ? "Browser alerts aren't available here. Use the RSS feed or original job-site alerts."
    : Notification.permission === "denied"
      ? "Alerts are blocked. You can change this in your browser’s site settings."
      : settings.alerts && allowed
        ? "Alerts are on for new listings detected while this page is open."
        : "Alerts are off.");
}

function registerAlerts() {
  return registration ??= navigator.serviceWorker.register(new URL("../notify-sw.js", import.meta.url))
    .catch((error) => {
      registration = undefined;
      throw error;
    });
}

async function notifyAbout(newJobs) {
  if (!newJobs.length || !settings.alerts || !browserAlerts() || Notification.permission !== "granted") return;
  try {
    await registerAlerts();
    const worker = await navigator.serviceWorker.ready;
    const title = newJobs.length === 1 ? "New dental vacancy" : `${newJobs.length} new dental vacancies`;
    const body = newJobs.length === 1
      ? `${newJobs[0].title} · ${locationLabel(newJobs[0])}`
      : "Open Dublin Dental Jobs to see the latest listings.";
    await worker.showNotification(title, {
      body, icon: new URL("./icon.svg", import.meta.url).href,
    });
  } catch (error) {
    console.warn("Could not display the job alert.", error);
    renderAlerts("Couldn't display a browser alert. Use the RSS feed for another option.");
  }
}

async function loadJobs() {
  if (fetching) return;
  fetching = true;
  lastCheck = Date.now();
  $("refresh").disabled = true;
  $("feed-status").textContent = "Checking the published feed…";
  try {
    const response = await fetch(new URL("../data/jobs.json", import.meta.url), {
      cache: "no-store", signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Board returned HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.jobs) || !["ok", "partial", "stale", "unavailable"].includes(data.status)) {
      throw new Error("Board data is incomplete");
    }
    snapshot = data;
    const fresh = new Set();
    const statuses = Object.entries(data.sources ?? { portmandentex: data }).map(([source, feed]) => {
      const label = Object.hasOwn(sourceNames, source) ? sourceNames[source] : source;
      const timestamp = Date.parse(feed.lastSuccessfulAt);
      if (!Number.isFinite(timestamp)) return `${label}: unavailable`;
      const date = `${prettyTime.format(timestamp)} (Ireland time)`;
      if (feed.status !== "ok" || Date.now() - timestamp > 3 * 60 * 60 * 1000) {
        return `${label}: may be out of date (last checked ${date})`;
      }
      fresh.add(source);
      return `${label}: checked ${date}`;
    });
    $("feed-status").textContent = statuses.join(" · ");
    renderJobs();

    if (fresh.size) {
      readSettings();
      const checkedJobs = data.jobs.filter((job) => fresh.has(job.source ?? "portmandentex"));
      const previous = new Set(settings.seen || []);
      const newJobs = settings.seen === null ? [] : checkedJobs.filter((job) => !previous.has(job.id));
      settings.seen = [...new Set([...checkedJobs.map((job) => job.id), ...previous])].slice(0, 1000);
      saveSettings();
      void notifyAbout(newJobs);
    }
  } catch (error) {
    console.warn("Could not refresh job listings.", error);
    $("feed-status").textContent = snapshot?.jobs.length
      ? "Refresh failed. Showing the previous listings."
      : "Couldn't load the feed. Try the original job sites below.";
    renderJobs();
  } finally {
    fetching = false;
    $("refresh").disabled = false;
  }
}

$("keyword").addEventListener("input", renderJobs);
for (const id of ["role", "county", "sort"]) $(id).addEventListener("change", renderJobs);
$("refresh").addEventListener("click", loadJobs);
$("alert-toggle").addEventListener("click", async () => {
  if (settings.alerts && Notification.permission === "granted") {
    settings.alerts = false;
  } else {
    try {
      const permission = await Notification.requestPermission();
      settings.alerts = permission === "granted";
      if (settings.alerts) await registerAlerts();
    } catch (error) {
      console.warn("Could not enable job alerts.", error);
      settings.alerts = false;
      saveSettings();
      renderAlerts("Couldn't enable browser alerts. The RSS feed still works in a reader.");
      return;
    }
  }
  saveSettings();
  renderAlerts();
});
readSettings();
renderAlerts();
void loadJobs();
setInterval(loadJobs, 5 * 60 * 1000);
navigator.serviceWorker?.addEventListener("message", (event) => {
  if (event.data?.type === "show-job-listings") window.location.hash = "jobs";
});
window.addEventListener("focus", () => {
  renderAlerts();
  if (Date.now() - lastCheck > 60 * 1000) void loadJobs();
});

const draft = $("cv-text");
const importFile = $("cv-file");
const maxChars = draft.maxLength;

function updateCV() {
  const hasDraft = Boolean(draft.value.trim());
  for (const id of ["download", "print", "clear"]) $(id).disabled = !hasDraft;
  const suggestions = reviewCV(draft.value, $("cv-role").value);
  const items = suggestions.map(({ title, advice, insert }) => {
    const item = make("li");
    item.append(make("h4", title), make("p", advice));
    if (insert) {
      const use = make("button", "Insert Stamp 1G line if accurate", "button secondary");
      use.type = "button";
      use.addEventListener("click", () => {
        const lines = draft.value.trimStart().split("\n");
        const gap = lines.findIndex((line) => !line.trim());
        lines.splice(gap < 0 ? Math.min(3, lines.length) : gap, 0, insert);
        const next = lines.join("\n");
        if (next.length > maxChars) {
          $("cv-status").textContent = "The draft is too long to add this line.";
          return;
        }
        draft.value = next;
        draft.focus();
        $("cv-status").textContent = "Work-authorisation line added to your draft.";
        updateCV();
      });
      item.append(use);
    }
    return item;
  });
  $("suggestions").replaceChildren(...(items.length ? items : [make("li", "Import or paste a CV to see suggestions.")]));
}

async function extractPDF(file) {
  const pdfjs = await import("../vendor/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdf.worker.mjs", import.meta.url).href;
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: new URL("../vendor/cmaps/", import.meta.url).href,
    standardFontDataUrl: new URL("../vendor/standard_fonts/", import.meta.url).href,
    cMapPacked: true, isEvalSupported: false, useWasm: false, useSystemFonts: false,
  });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 15) throw new Error("Use a PDF of 15 pages or fewer.");
    const pages = [];
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const { items } = await page.getTextContent();
      pages.push(items.filter((item) => "str" in item).map((item) => `${item.str}${item.hasEOL ? "\n" : ""}`).join(""));
    }
    return pages.join("\n\n");
  } finally {
    await task.destroy();
  }
}

draft.addEventListener("input", updateCV);
$("cv-role").addEventListener("change", updateCV);
importFile.addEventListener("change", async () => {
  const file = importFile.files[0];
  if (!file) return;
  const originalDraft = draft.value;
  importFile.disabled = true;
  $("cv-status").textContent = "Reading file on this device…";
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error("Use a file no larger than 5 MB.");
    const text = (/\.pdf$/i.test(file.name)
      ? await extractPDF(file)
      : /\.txt$/i.test(file.name) ? await file.text() : "").trim();
    if (!text) throw new Error("No text found. Use a text-based PDF or paste the CV text. Scanned images aren't supported.");
    if (text.length > maxChars) throw new Error("This CV is too long. Try a shorter file.");
    if (draft.value !== originalDraft) throw new Error("The CV changed while the file was loading. Your edits have been kept.");
    if (originalDraft.trim() && !window.confirm("Replace your current draft with the imported text?")) {
      $("cv-status").textContent = "Import cancelled. Your draft is unchanged.";
      return;
    }
    draft.value = text;
    $("cv-status").textContent = "CV text imported. Check spacing and line breaks before exporting.";
    updateCV();
  } catch (error) {
    $("cv-status").textContent = error.name === "PasswordException"
      ? "This PDF is password-protected. Use an unlocked copy or paste the text."
      : `Import failed: ${error.message}`;
  } finally {
    importFile.value = "";
    importFile.disabled = false;
  }
});

$("download").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([draft.value], { type: "text/plain;charset=utf-8" }));
  const link = make("a");
  link.href = url;
  link.download = "cv-draft.txt";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$("print").addEventListener("click", () => {
  $("print-cv").textContent = draft.value;
  window.print();
  $("print-cv").textContent = "";
});
$("clear").addEventListener("click", () => {
  if (!window.confirm("Clear the CV draft from this page?")) return;
  draft.value = "";
  $("cv-status").textContent = "Draft cleared.";
  updateCV();
});
updateCV();
