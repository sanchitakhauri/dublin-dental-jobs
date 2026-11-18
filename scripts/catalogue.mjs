import { readFile } from "node:fs/promises";
import { areaFor, classifyRole, safeHttps } from "../assets/jobs.mjs";

export const cataloguePath = new URL("../.cache/jobs.json", import.meta.url);
export const emptyCatalogue = { status: "unavailable", lastSuccessfulAt: null, jobs: [] };
export const employer = "PortmanDentex";
export const employerFeed = `https://api.smartrecruiters.com/v1/companies/${employer}/postings`;

export async function readCatalogue() {
  try {
    return JSON.parse(await readFile(cataloguePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return emptyCatalogue;
    throw error;
  }
}

export function extractPay(detail) {
  const text = Object.values(detail.jobAd?.sections ?? {}).map((section) => section?.text || "").join(" ")
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
    id: `${employer.toLowerCase()}:${selected.id}`,
    title: posting.name.trim(),
    employer,
    publishedAt: Number.isFinite(date) ? new Date(date).toISOString() : null,
    pay: extractPay(detail),
    url: canonical,
  };
}

const escapeXML = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
})[char]);

export function buildRSS(catalogue, site) {
  const base = safeHttps(site);
  if (!base) throw new Error("SITE_URL must be an HTTPS URL");
  const date = Date.parse(catalogue.lastSuccessfulAt);
  const items = catalogue.jobs.map((job) => {
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
    <description>Vacancies in Dublin, Wicklow and Kildare from the connected employer feed.</description>
    <language>en-ie</language>
    ${Number.isFinite(date) ? `<lastBuildDate>${new Date(date).toUTCString()}</lastBuildDate>` : ""}
${items.join("\n")}
  </channel>
</rss>\n`;
}
