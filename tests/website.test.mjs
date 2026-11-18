import assert from "node:assert/strict";
import test from "node:test";
import { areaFor, classifyRole, filterJobs, payLabel, safeHttps } from "../assets/jobs.mjs";
import { reviewCV } from "../assets/cv-review.mjs";
import { buildRSS, extractPay, normalizePosting } from "../scripts/catalogue.mjs";

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

test("RSS keeps stable job identifiers and escapes untrusted metadata", () => {
  const rss = buildRSS({ jobs: [{
    id: "employer:1", title: "Dentist & Dental Surgeon", town: "Bray", county: "Wicklow",
    url: "https://example.com/apply?a=1&b=2", employer: "Test Clinic", publishedAt: "2026-03-01",
  }] }, "https://example.com/site/");
  assert.match(rss, /<guid isPermaLink="false">employer:1<\/guid>/);
  assert.match(rss, /Dentist &amp; Dental Surgeon/);
  assert.match(rss, /a=1&amp;b=2/);
});

test("role-specific CV suggestions do not add unverified credentials", () => {
  assert.deepEqual(reviewCV(" ", "support"), []);
  const support = reviewCV("BDS\nSkin Aesthetician\nSterilisation and patient records", "support");
  assert.ok(support.some((item) => item.title.includes("aesthetics")));
  assert.ok(support.some((item) => item.advice.includes("sterilisation") && item.advice.includes("clinical documentation")));
  assert.equal(support.filter((item) => item.insert).length, 1);
  const dentist = reviewCV("BDS\nWork authorisation: Stamp 1G", "dentist");
  assert.ok(dentist.some((item) => item.title.includes("Council")));
  assert.ok(dentist.every((item) => !item.insert));
});
