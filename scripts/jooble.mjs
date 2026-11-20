import { areaFor, classifyRole, safeHttps } from "../assets/jobs.mjs";
import { extractEURPay } from "./catalogue.mjs";

const endpoint = "https://ie.jooble.org/api/";
const counties = ["Dublin", "Wicklow", "Kildare"];
const linkHosts = new Set(["ie.jooble.org", "jooble.org", "www.jooble.org"]);

function normalizeJob(job) {
  const title = typeof job?.title === "string" ? job.title.trim() : "";
  const role = classifyRole(title);
  const area = typeof job?.location === "string"
    ? areaFor({ country: "ie", city: job.location }) : null;
  const url = safeHttps(job?.link);
  const id = typeof job?.id === "string" ? job.id : "";
  if (!role || !area || !/^-?\d{1,20}$/.test(id) || !url || !linkHosts.has(new URL(url).hostname)) return null;

  const date = Date.parse(job.updated);
  return {
    ...area,
    id: `jooble:${id}`,
    title,
    role,
    employer: typeof job.company === "string" && job.company.trim()
      ? job.company.trim() : "Employer not listed",
    publishedAt: null,
    updatedAt: Number.isFinite(date) ? new Date(date).toISOString() : null,
    pay: typeof job.salary === "string" ? extractEURPay(job.salary) : null,
    url,
  };
}

async function searchCounty(apiKey, county, request) {
  let response;
  try {
    response = await request(`${endpoint}${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        keywords: "dental nurse, dental assistant, dentist, dental surgeon",
        location: county,
        ResultOnPage: 100,
      }),
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
  } catch {
    // The request URL contains the credential. Do not log request errors or response bodies.
    throw new Error(`Jooble request failed for ${county}`);
  }
  if (!response.ok) throw new Error(`Jooble returned HTTP ${response.status} for ${county}`);

  let page;
  try {
    page = JSON.parse(await response.text(), (name, value, context) =>
      name === "id" && typeof value === "number" ? context.source : value);
  } catch {
    throw new Error(`Jooble returned invalid JSON for ${county}`);
  }
  if (!Array.isArray(page?.jobs)) throw new Error(`Jooble returned no results array for ${county}`);
  return page.jobs.map(normalizeJob).filter(Boolean);
}

export async function fetchJooble(apiKey, request = fetch) {
  const results = await Promise.all(counties.map((county) => searchCounty(apiKey, county, request)));
  return results.flat();
}
