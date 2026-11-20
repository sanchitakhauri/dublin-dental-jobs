export const roleNames = {
  nurse: "Dental nurse",
  assistant: "Dental assistant",
  dentist: "Dentist",
};

export const sourceNames = {
  portmandentex: "PortmanDentex",
  jooble: "Jooble Ireland",
};

const english = new Intl.Collator("en-IE", { sensitivity: "base" });
const eur = new Intl.NumberFormat("en-IE", {
  style: "currency", currency: "EUR", maximumFractionDigits: 2, minimumFractionDigits: 0,
});
const sandyford = [53.272, -6.226];
const places = [
  ["Dublin", "Dublin", 53.350, -6.260],
  ["Dublin City Centre", "Dublin", 53.350, -6.260],
  ["Sandyford", "Dublin", 53.272, -6.226],
  ["Dundrum", "Dublin", 53.292, -6.244],
  ["Stillorgan", "Dublin", 53.289, -6.195],
  ["Blackrock", "Dublin", 53.301, -6.177],
  ["Dun Laoghaire", "Dublin", 53.294, -6.134],
  ["Leopardstown", "Dublin", 53.265, -6.197],
  ["Rathfarnham", "Dublin", 53.298, -6.286],
  ["Ranelagh", "Dublin", 53.325, -6.253],
  ["Ballsbridge", "Dublin", 53.329, -6.229],
  ["Clonskeagh", "Dublin", 53.304, -6.234],
  ["Churchtown", "Dublin", 53.298, -6.258],
  ["Tallaght", "Dublin", 53.287, -6.368],
  ["Citywest", "Dublin", 53.290, -6.421],
  ["Lucan", "Dublin", 53.357, -6.448],
  ["Clondalkin", "Dublin", 53.321, -6.401],
  ["Blanchardstown", "Dublin", 53.389, -6.378],
  ["Swords", "Dublin", 53.459, -6.218],
  ["Malahide", "Dublin", 53.451, -6.154],
  ["Balbriggan", "Dublin", 53.609, -6.181],
  ["Bray", "Wicklow", 53.202, -6.111],
  ["Greystones", "Wicklow", 53.141, -6.064],
  ["Delgany", "Wicklow", 53.130, -6.089],
  ["Wicklow Town", "Wicklow", 52.982, -6.045],
  ["Blessington", "Wicklow", 53.168, -6.533],
  ["Arklow", "Wicklow", 52.796, -6.157],
  ["Naas", "Kildare", 53.220, -6.659],
  ["Newbridge", "Kildare", 53.182, -6.798],
  ["Maynooth", "Kildare", 53.382, -6.591],
  ["Celbridge", "Kildare", 53.337, -6.539],
  ["Leixlip", "Kildare", 53.365, -6.494],
  ["Clane", "Kildare", 53.292, -6.689],
  ["Athy", "Kildare", 52.992, -6.987],
  ["Kildare Town", "Kildare", 53.158, -6.910],
];

export function fold(value) {
  return String(value ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

export function classifyRole(title) {
  const name = fold(title);
  if (/\bdental[\s-]+nurs(?:e|ing)\b|\bnurse\s*-\s*dental\b/.test(name)) return "nurse";
  if (/\b(?:dental|chairside)[\s-]+assist(?:ant|ing)\b/.test(name)) return "assistant";
  if (/\b(?:dentist|dental surgeon|dental associate|orthodontist|endodontist|periodontist|prosthodontist|oral surgeon)\b/.test(name)) return "dentist";
  return null;
}

export function estimateDistance(lat, lon) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const a = Math.sin(radians(lat - sandyford[0]) / 2) ** 2
    + Math.cos(radians(sandyford[0])) * Math.cos(radians(lat))
    * Math.sin(radians(lon - sandyford[1]) / 2) ** 2;
  return Math.round(6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

export function areaFor(location = {}) {
  if (!["ie", "irl", "ireland", "republic of ireland"].includes(fold(location.country))) return null;
  const town = String(location.city ?? "").trim();
  const region = fold(location.region);
  const townKey = fold(town).split(",")[0].trim();
  const exact = places.find(([place]) => fold(place) === townKey);
  const countyFromLabel = (label) => /\bdublin\b/.test(label) ? "Dublin"
    : /\bwicklow\b/.test(label) ? "Wicklow"
      : /\bkildare\b/.test(label) ? "Kildare" : null;
  const county = countyFromLabel(region) ?? exact?.[1] ?? countyFromLabel(fold(town));
  if (!county) return null;
  return {
    town,
    county,
    distanceKm: exact?.[1] === county ? estimateDistance(exact[2], exact[3]) : null,
  };
}

export function locationLabel(job) {
  return !job.town || fold(job.town).includes(fold(job.county))
    ? job.town || job.county
    : `${job.town}, ${job.county}`;
}

export function payLabel(pay) {
  if (!pay) return "Pay not advertised";
  const amount = pay.min === pay.max ? eur.format(pay.max) : `${eur.format(pay.min)}–${eur.format(pay.max)}`;
  const period = pay.period === "hourly" ? "hour" : "year";
  return `${pay.starting ? "From " : ""}${amount} / ${period}`;
}

export function filterJobs(jobs, { keyword, role, county, sort }) {
  const terms = fold(keyword).split(/\s+/).filter(Boolean);
  return jobs.filter((job) => {
    const searchable = fold([job.title, job.employer, job.town, job.county, roleNames[job.role]].join(" "));
    return (!role || job.role === role)
      && (!county || job.county === county)
      && terms.every((term) => searchable.includes(term));
  }).sort((a, b) => {
    if (sort === "distance") {
      const byDistance = (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity);
      if (byDistance) return byDistance;
    } else if (sort === "location") {
      const byLocation = english.compare(locationLabel(a), locationLabel(b));
      if (byLocation) return byLocation;
    } else if (sort === "hourly" || sort === "annual") {
      const amount = (j) => j.pay?.period === sort ? j.pay.max : -Infinity;
      const byPay = amount(b) - amount(a);
      if (byPay) return byPay;
    }
    return (Date.parse(b.publishedAt ?? b.updatedAt) || 0) - (Date.parse(a.publishedAt ?? a.updatedAt) || 0)
      || english.compare(a.title, b.title) || english.compare(a.id, b.id);
  });
}

export function safeHttps(url) {
  if (typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password ? parsed.href : null;
  } catch {
    return null;
  }
}
