import { cp, mkdir, writeFile } from "node:fs/promises";
import { buildRSS, readCatalogue } from "./catalogue.mjs";

const root = new URL("../", import.meta.url);
const out = new URL("dist/", root);
await mkdir(new URL("data/", out), { recursive: true });
await mkdir(new URL("vendor/", out), { recursive: true });
for (const path of ["index.html", "assets", "notify-sw.js"]) {
  await cp(new URL(path, root), new URL(path, out), { recursive: true });
}
const pdf = new URL("node_modules/pdfjs-dist/", root);
for (const [source, destination] of [
  ["build/pdf.mjs", "pdf.mjs"], ["build/pdf.worker.mjs", "pdf.worker.mjs"],
  ["cmaps", "cmaps"], ["standard_fonts", "standard_fonts"], ["LICENSE", "LICENSE"],
]) {
  await cp(new URL(source, pdf), new URL(`vendor/${destination}`, out), { recursive: true });
}
const catalogue = await readCatalogue();
await writeFile(new URL("data/jobs.json", out), `${JSON.stringify(catalogue, null, 2)}\n`);
const site = process.env.SITE_URL || "https://sanchitakhauri.github.io/dublin-dental-jobs/";
await writeFile(new URL("data/openings.xml", out), buildRSS(catalogue, site));
await writeFile(new URL(".nojekyll", out), "");
console.log(`Built site in ${out.pathname}`);
