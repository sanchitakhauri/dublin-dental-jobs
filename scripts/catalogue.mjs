import { readFile } from "node:fs/promises";
import { areaFor, classifyRole, filterJobs, safeHttps } from "../assets/jobs.mjs";

export const cataloguePath = new URL("../.cache/jobs.json", import.meta.url);
export const emptyCatalogue = { status: "unavailable", lastSuccessfulAt: null, jobs: [] };
export const portmanSource = "portmandentex";
export const employer = "PortmanDentex";
export const employerFeed = `https://api.smartrecruiters.com/v1/companies/${employer}/postings`;

export function portmanCheckedAt(catalogue) {
  return catalogue.sources ? catalogue.sources[portmanSource]?.lastSuccessfulAt : catalogue.lastSuccessfulAt;
}

export async function readCatalogue() {
  try {
    return JSON.parse(await readFile(cataloguePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return emptyCatalogue;
    throw error;
  }
}

export function extractEURPay(value) {
  const text = value
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:nbsp|#160);/gi, " ")
    .replace(/&(?:euro|#8364|#x20ac);/gi, "€")
    .replace(/&(?:ndash|#8211|#x2013);/gi, "–")
    .replace(/\s+/g, " ");
  const number = "(\\d{1,3}(?:,\\d{3})+(?:\\.\\d{1,2})?|\\d{1,6}(?:\\.\\d{1,2})?)";
  const rate = new RegExp(
    `(?:\\b(from)\\s+)?(?:€\\s*|\\bEUR\\s+)${number}(?:\\s*(?:to|[-–—])\\s*(?:€\\s*|EUR\\s+)?${number})?\\s*(?:per\\s+|an?\\s+|/\\s*)(hours?|hrs?|h|annum|year|yr)\\b`,
    "gi",
  );
  const amounts = [];
  for (const match of text.matchAll(rate)) {
    const before = text.slice(0, match.index).split(/[:;.!?]/).at(-1).slice(-45);
    const after = text.slice(match.index + match[0].length);
    if (/\b(?:bonus|allowance|deduction|discount|fee|reimbursement|travel)\b/i.test(before)
        || /^\s*(?:bonus|allowance|deduction|discount|fee|reimbursement)\b/i.test(after)) continue;
    const min = Number(match[2].replaceAll(",", ""));
    const max = match[3] ? Number(match[3].replaceAll(",", "")) : min;
    const period = match[4].toLowerCase().startsWith("h") ? "hourly" : "annual";
    if (min > 0 && max >= min) amounts.push({ min, max, period, starting: Boolean(match[1]) && !match[3] });
  }
  const distinct = new Set(amounts.map((pay) => JSON.stringify(pay)));
  return distinct.size === 1 ? amounts[0] : null;
}

export function extractPay(detail) {
  const sections = Object.values(detail.jobAd?.sections ?? {});
  return extractEURPay(sections.map((section) => section?.text || "").join(" "));
}

export function selectPosting(posting) {
  const id = typeof posting.id === "string" || Number.isSafeInteger(posting.id) ? String(posting.id) : "";
  const role = classifyRole(posting.name);
  const area = areaFor(posting.location);
  if (!id || !/^[\w-]{1,80}$/.test(id) || !role || !area) return null;
  return { id, role, ...area };
}

export function normalizePosting(posting, detail, selected = selectPosting(posting)) {
  if (!selected) return null;
  const canonical = [detail.postingUrl, posting.postingUrl, detail.applyUrl]
    .map(safeHttps).filter(Boolean).find((url) => {
      const { hostname } = new URL(url);
      return ["jobs.smartrecruiters.com", "careers.smartrecruiters.com", "smrtr.io"].includes(hostname);
    });
  if (!canonical) throw new Error(`Missing official job link for ${selected.id}`);
  const date = Date.parse(posting.releasedDate);
  return {
    ...selected,
    id: `${portmanSource}:${selected.id}`,
    title: posting.name.trim(),
    employer,
    publishedAt: Number.isFinite(date) ? new Date(date).toISOString() : null,
    pay: extractPay(detail),
    url: canonical,
  };
}

export function mergeCatalogue(results, previous, checkedAt) {
  const sources = {};
  const jobs = new Map();
  const links = new Set();
  for (const { source, postings } of results) {
    const updated = postings !== null;
    const previousCheck = source === portmanSource ? portmanCheckedAt(previous) : null;
    const hasFallback = !updated && Number.isFinite(Date.parse(previousCheck));
    sources[source] = {
      status: updated ? "ok" : hasFallback ? "stale" : "unavailable",
      lastSuccessfulAt: updated ? checkedAt : hasFallback ? previousCheck : null,
    };
    const available = postings ?? (hasFallback
      ? previous.jobs.filter((job) => typeof job.id === "string" && job.id.startsWith(`${portmanSource}:`))
      : []);
    for (const job of available) {
      if (jobs.has(job.id) || links.has(job.url)) continue;
      jobs.set(job.id, { ...job, source });
      links.add(job.url);
    }
  }

  const feeds = Object.values(sources);
  const latest = feeds.map((feed) => feed.lastSuccessfulAt).filter(Boolean).sort().at(-1) ?? null;
  const refreshed = feeds.filter((feed) => feed.status === "ok").length;
  return {
    status: refreshed ? refreshed === feeds.length ? "ok" : "partial" : latest ? "stale" : "unavailable",
    lastSuccessfulAt: latest,
    sources,
    jobs: filterJobs([...jobs.values()], { sort: "newest" }),
  };
}

const escapeXML = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
})[char]);

export function buildRSS(catalogue, site) {
  const base = safeHttps(site);
  if (!base) throw new Error("SITE_URL must be an HTTPS URL");
  const date = Date.parse(portmanCheckedAt(catalogue));
  const items = catalogue.jobs.filter((job) => job.id.startsWith(`${portmanSource}:`)).map((job) => {
    const pubDate = Date.parse(job.publishedAt);
    return `    <item>
      <title>${escapeXML(job.title)} — ${escapeXML(job.town || job.county)}</title>
      <link>${escapeXML(job.url)}</link>
      <guid isPermaLink="false">${escapeXML(job.id)}</guid>
      ${Number.isFinite(pubDate) ? `<pubDate>${new Date(pubDate).toUTCString()}</pubDate>` : ""}
      <description>${escapeXML(job.employer)} · ${escapeXML(job.county)}</description>
    </item>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Dublin Dental Jobs openings</title>
    <link>${escapeXML(base)}</link>
    <description>Vacancies in Dublin, Wicklow and Kildare from the PortmanDentex employer feed.</description>
    <language>en-ie</language>
    ${Number.isFinite(date) ? `<lastBuildDate>${new Date(date).toUTCString()}</lastBuildDate>` : ""}
${items.join("\n")}
  </channel>
</rss>\n`;
}
