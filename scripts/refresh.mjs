import { mkdir, writeFile } from "node:fs/promises";
import {
  cataloguePath, employerFeed, emptyCatalogue, mergeCatalogue, normalizePosting,
  portmanCheckedAt, portmanSource, readCatalogue, selectPosting,
} from "./catalogue.mjs";
import { fetchJooble } from "./jooble.mjs";
import { safeHttps } from "../assets/jobs.mjs";

async function getJSON(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${new URL(url).pathname}`);
  return response.json();
}

async function fetchPostings() {
  const size = 100;
  const selected = new Map();
  for (let offset = 0; ; offset += size) {
    const url = new URL(employerFeed);
    url.search = new URLSearchParams({ country: "ie", limit: String(size), offset: String(offset) });
    const page = await getJSON(url);
    if (!Array.isArray(page.content) || !Number.isInteger(page.totalFound) || page.totalFound < 0) {
      throw new Error("Unexpected postings response");
    }
    if (!page.content.length && offset < page.totalFound) throw new Error("The feed omitted a page of postings");
    for (const posting of page.content) {
      const target = selectPosting(posting);
      if (target) selected.set(target.id, { posting, target });
    }
    if (offset + size >= page.totalFound) break;
    if (offset >= 4900) throw new Error("Postings feed exceeded its expected page count");
  }
  const entries = [...selected.values()];
  const jobs = [];
  for (let i = 0; i < entries.length; i += 4) {
    const group = await Promise.all(entries.slice(i, i + 4).map(async ({ posting, target }) => {
      const detail = await getJSON(`${employerFeed}/${encodeURIComponent(target.id)}`);
      return normalizePosting(posting, detail, target);
    }));
    jobs.push(...group);
  }
  return jobs;
}

async function previousCatalogue() {
  const local = await readCatalogue();
  if (Number.isFinite(Date.parse(portmanCheckedAt(local)))) return local;
  const site = safeHttps(process.env.SITE_URL);
  if (!site) return emptyCatalogue;
  try {
    const published = await getJSON(new URL("data/jobs.json", `${site.replace(/\/+$/, "")}/`));
    if (Array.isArray(published.jobs) && Number.isFinite(Date.parse(portmanCheckedAt(published)))) return published;
    console.warn("No previous PortmanDentex snapshot at the site URL.");
  } catch (error) {
    console.warn(`Could not load previous public catalogue: ${error.message}`);
  }
  return emptyCatalogue;
}

const feeds = [[portmanSource, fetchPostings]];
const joobleKey = process.env.JOOBLE_IE_API_KEY?.trim();
if (joobleKey) feeds.push(["jooble", () => fetchJooble(joobleKey)]);

const results = await Promise.all(feeds.map(async ([source, fetchJobs]) => {
  try {
    const postings = await fetchJobs();
    console.log(`${source}: fetched ${postings.length} relevant posting(s) before deduplication.`);
    return { source, postings };
  } catch (error) {
    const detail = error.cause?.code ? ` (${error.cause.code})` : "";
    console.warn(`Could not refresh ${source}: ${error.message}${detail}`);
    return { source, postings: null };
  }
}));

const previous = results.some(({ source, postings }) => source === portmanSource && postings === null)
  ? await previousCatalogue() : emptyCatalogue;
const catalogue = mergeCatalogue(results, previous, new Date().toISOString());
for (const [source, feed] of Object.entries(catalogue.sources)) {
  if (feed.status === "stale") console.warn(`${source}: publishing last successful data as stale.`);
}

await mkdir(new URL("./", cataloguePath), { recursive: true });
await writeFile(cataloguePath, `${JSON.stringify(catalogue, null, 2)}\n`);
