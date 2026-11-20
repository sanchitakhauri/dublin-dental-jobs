import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { areaFor, classifyRole, filterJobs, payLabel, safeHttps } from "../assets/jobs.mjs";
import { buildRSS, emptyCatalogue, extractPay, mergeCatalogue, normalizePosting } from "../scripts/catalogue.mjs";
import { fetchJooble } from "../scripts/jooble.mjs";

test("classifies target titles without including unrelated roles", () => {
  for (const [title, role] of [
    ["Senior Dental Nurse — Maternity Cover", "nurse"],
    ["Part-time Chairside Assistant", "assistant"],
    ["Associate Dentist", "dentist"],
    ["HSE General Dental Surgeon", "dentist"],
    ["Dental Hygienist", null],
    ["Dental Receptionist", null],
  ]) assert.equal(classifyRole(title), role);
});

test("estimates distance only for identified towns in the covered Irish counties", () => {
  assert.equal(areaFor({ city: "Sandyford", country: "IE" }).distanceKm, 0);
  assert.equal(areaFor({ city: "Bray", country: "Ireland" }).county, "Wicklow");
  assert.equal(areaFor({ city: "Naas", country: "ie" }).county, "Kildare");
  assert.equal(areaFor({ city: "Unknown", region: "County Wicklow", country: "IE" }).distanceKm, null);
  assert.equal(areaFor({ city: "Cork", country: "IE" }), null);
  assert.equal(areaFor({ city: "Dublin", country: "US" }), null);
});

const advert = (text) => ({ jobAd: { sections: { jobDescription: { text } } } });

test("extracts clear advertised EUR base pay without inventing pay from bonuses", () => {
  const starting = extractPay(advert("<li>Competitive pay: From &euro;19 per hour</li>"));
  assert.deepEqual(starting, { period: "hourly", min: 19, max: 19, starting: true });
  assert.equal(payLabel(starting), "From €19 / hour");
  assert.deepEqual(extractPay(advert("Salary: €32,000–€44,000 per annum.")),
    { period: "annual", min: 32000, max: 44000, starting: false });
  assert.equal(extractPay(advert("Travel allowance €18 per hour.")), null);
  assert.equal(extractPay(advert("£16 per hour and a €1,000 signing bonus.")), null);
  assert.equal(extractPay(advert("€15 per hour on weekdays and €25 per hour on Saturdays.")), null);
});

test("filters and sorts known rates or distances ahead of missing or incomparable ones", () => {
  const base = { role: "nurse", employer: "Clinic", publishedAt: "2026-03-01T00:00:00Z" };
  const records = [
    { ...base, id: "a", town: "Dundrum", county: "Dublin", title: "Dental Nurse", distanceKm: 2, pay: { period: "hourly", max: 19 } },
    { ...base, id: "b", town: "Bray", county: "Wicklow", title: "Dental Nurse", distanceKm: 10, pay: { period: "hourly", max: 25 } },
    { ...base, id: "c", town: "Naas", county: "Kildare", title: "Dental Nurse", distanceKm: null, pay: { period: "annual", max: 39000 } },
    { ...base, id: "d", town: "Dublin", county: "Dublin", title: "Dentist", role: "dentist", distanceKm: 8, pay: null },
  ];
  assert.deepEqual(filterJobs(records, { role: "nurse", sort: "hourly" }).map((job) => job.id), ["b", "a", "c"]);
  assert.deepEqual(filterJobs(records, { role: "nurse", sort: "distance" }).map((job) => job.id), ["a", "b", "c"]);
  assert.deepEqual(filterJobs(records, { county: "Dublin", keyword: "clinic dundrum" }).map((job) => job.id), ["a"]);
});

test("normalizes only metadata and requires an official application link", () => {
  const posting = {
    name: "Dental Nurse", id: "123", releasedDate: "2026-03-03T08:00:00Z",
    location: { country: "ie", city: "Dundrum" },
  };
  const detail = {
    ...advert("Private advert body. Pay from €18/hour."),
    postingUrl: "https://jobs.smartrecruiters.com/PortmanDentex/123-dental-nurse",
  };
  const job = normalizePosting(posting, detail);
  assert.equal(job.id, "portmandentex:123");
  assert.equal(job.county, "Dublin");
  assert.equal(job.pay.max, 18);
  assert.equal(job.url, detail.postingUrl);
  assert.ok(!JSON.stringify(job).includes("Private advert body"));
  assert.throws(() => normalizePosting(posting, { postingUrl: "https://example.com/123" }), /official job link/);
  assert.equal(safeHttps("javascript:alert(1)"), null);
});

test("RSS keeps stable job identifiers, escapes metadata and excludes Jooble results", () => {
  const rss = buildRSS({ jobs: [{
    id: "portmandentex:1", title: "Dentist & Dental Surgeon", town: "Bray", county: "Wicklow",
    url: "https://example.com/apply?a=1&b=2", employer: "Test Clinic", publishedAt: "2026-03-01",
  }, {
    id: "jooble:1", source: "jooble", title: "Dental Nurse via Jooble", town: "Naas", county: "Kildare",
    url: "https://ie.jooble.org/jdp/1",
  }] }, "https://example.com/site/");
  assert.match(rss, /<guid isPermaLink="false">portmandentex:1<\/guid>/);
  assert.match(rss, /Dentist &amp; Dental Surgeon/);
  assert.match(rss, /a=1&amp;b=2/);
  assert.doesNotMatch(rss, /jooble:1|ie\.jooble\.org/);
});

test("Jooble Ireland fetches one page per county and preserves IDs and original advert links", async () => {
  const calls = [];
  const visit = "https://ie.jooble.org/jdp/-9123456789012345678?p=original";
  const input = {
    title: "Dental Assistant",
    location: "Bray, Co. Wicklow",
    company: "Example Dental Clinic",
    salary: "€21-€25 per hour",
    link: visit,
    updated: "2026-11-19T13:00:00Z",
    snippet: "Do not publish this paragraph",
  };
  const response = await fetchJooble("test-key", async (url, options) => {
    const query = JSON.parse(options.body);
    calls.push(query.location);
    assert.equal(url, "https://ie.jooble.org/api/test-key");
    assert.equal(options.method, "POST");
    if (query.location !== "Wicklow") return Response.json({ totalCount: 0, jobs: [] });
    const accepted = JSON.stringify(input).replace("{", '{"id":-9123456789012345678,');
    const other = [
      { ...input, id: "2", location: "Galway" },
      { ...input, id: "3", title: "Dental Receptionist" },
      { ...input, id: "4", link: "https://example.com/unexpected" },
    ].map((job) => JSON.stringify(job));
    return new Response(`{"totalCount":4,"jobs":[${accepted},${other.join(",")}]}`);
  });
  assert.deepEqual(calls, ["Dublin", "Wicklow", "Kildare"]);
  assert.equal(response.length, 1);
  const [job] = response;
  assert.equal(job.id, "jooble:-9123456789012345678");
  assert.equal(job.url, visit);
  assert.equal(job.county, "Wicklow");
  assert.equal(job.role, "assistant");
  assert.equal(job.publishedAt, null);
  assert.equal(job.updatedAt, "2026-11-19T13:00:00.000Z");
  assert.equal(payLabel(job.pay), "€21–€25 / hour");
  assert.ok(!JSON.stringify(job).includes(input.snippet));
});

test("Jooble reports quota and network failures without disclosing its key", async () => {
  const key = "test-key-not-for-logs";
  await assert.rejects(fetchJooble(key, async () => new Response(key, { status: 429 })),
    (error) => error.message.includes("HTTP 429") && !String(error).includes(key));
  await assert.rejects(fetchJooble(key, async (url) => { throw new Error(`Request failed at ${url}`); }),
    (error) => error.message.includes("Jooble request failed") && !String(error).includes(key) && !error.cause);
});

test("merges the two feeds without duplicates and sorts by the date the source supplies", () => {
  const direct = {
    id: "portmandentex:1", title: "Dentist", url: "https://example.com/dentist", publishedAt: "2026-11-14T13:00:00Z",
  };
  const extra = {
    id: "jooble:1", title: "Dental Nurse", url: "https://ie.jooble.org/jdp/1", updatedAt: "2026-11-19T13:00:00Z",
  };
  const merged = mergeCatalogue([
    { source: "portmandentex", postings: [direct] },
    { source: "jooble", postings: [extra, extra, { ...extra, id: "jooble:2" }] },
  ], emptyCatalogue, "2026-11-20T13:00:00Z");
  assert.equal(merged.status, "ok");
  assert.deepEqual(merged.jobs.map(({ id, source }) => [id, source]),
    [["jooble:1", "jooble"], ["portmandentex:1", "portmandentex"]]);
});

test("independent feed failures preserve only the permitted fallback and removing Jooble drops its data", () => {
  const direct = { id: "portmandentex:1", title: "Dentist", url: "https://example.com/dentist" };
  const extra = { id: "jooble:1", title: "Dental Nurse", url: "https://ie.jooble.org/jdp/1" };
  const old = { status: "ok", lastSuccessfulAt: "2026-11-19T13:00:00Z", jobs: [direct] };
  const now = "2026-11-20T13:00:00Z";
  const portmanFailure = mergeCatalogue([
    { source: "portmandentex", postings: null }, { source: "jooble", postings: [extra] },
  ], old, now);
  assert.equal(portmanFailure.status, "partial");
  assert.equal(portmanFailure.sources.portmandentex.status, "stale");
  assert.deepEqual(new Set(portmanFailure.jobs.map((job) => job.id)), new Set([direct.id, extra.id]));

  const joobleFailure = mergeCatalogue([
    { source: "portmandentex", postings: [direct] }, { source: "jooble", postings: null },
  ], portmanFailure, now);
  assert.equal(joobleFailure.status, "partial");
  assert.equal(joobleFailure.sources.jooble.status, "unavailable");
  assert.deepEqual(joobleFailure.jobs.map((job) => job.id), [direct.id]);

  const keyRemoved = mergeCatalogue([{ source: "portmandentex", postings: null }], portmanFailure, now);
  assert.equal(keyRemoved.status, "stale");
  assert.equal(keyRemoved.lastSuccessfulAt, old.lastSuccessfulAt);
  assert.deepEqual(keyRemoved.jobs.map((job) => job.id), [direct.id]);
  assert.ok(!("jooble" in keyRemoved.sources));
});

test("rebuilding the vacancy site removes obsolete CV assets and controls", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "dublin-dental-jobs-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const path of ["index.html", "assets", "notify-sw.js", "scripts"]) {
    await cp(new URL(`../${path}`, import.meta.url), join(root, path), { recursive: true });
  }
  const dist = join(root, "dist");
  await mkdir(join(dist, "vendor"), { recursive: true });
  await writeFile(join(dist, "vendor", "pdf.mjs"), "// Old generated file");

  execFileSync(process.execPath, [join(root, "scripts", "build.mjs")], {
    env: { ...process.env, SITE_URL: "https://example.com/" },
  });

  const page = await readFile(join(dist, "index.html"), "utf8");
  assert.match(page, /id="job-results"/);
  assert.doesNotMatch(page, /CV prompts?|\b(?:id="cv"|href="#cv"|type="file")/i);
  const site = await readFile(join(dist, "assets", "site.mjs"), "utf8");
  assert.doesNotMatch(site, /cv-prompt|CV prompt/i);
  for (const path of ["assets/sample-cv.pdf", "assets/cv-prompt.mjs", "assets/cv-prompt-form.mjs", "vendor"]) {
    await assert.rejects(access(join(dist, path)), { code: "ENOENT" });
  }
});
