import { buildCVPrompt, detectCVTopics, validCVTopics } from "./cv-prompt.mjs";
import { locationLabel } from "./jobs.mjs";

const samplePDF = new URL("./sample-cv.pdf", import.meta.url);
const storageKey = `dublin-dental-jobs:cv-topics:${new URL("../", import.meta.url).pathname}`;

async function extractPDF(bytes) {
  const pdfjs = await import("../vendor/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdf.worker.mjs", import.meta.url).href;
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
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
      pages.push(items.filter((item) => "str" in item).map((item) => item.str).join(" "));
    }
    return pages.join("\n");
  } finally {
    await task.destroy();
  }
}

export function mountCVPrompt() {
  const $ = (id) => document.getElementById(id);
  const profile = $("job-profile");
  const fileInput = $("cv-reference");
  const remember = $("cv-remember");
  const sample = $("cv-sample");
  const clear = $("cv-clear");
  const referenceStatus = $("cv-reference-status");
  const output = $("cv-prompt");
  const copy = $("copy-prompt");
  const copyStatus = $("copy-status");
  let reference = null;
  let loading = false;

  function renderPrompt() {
    const prompt = buildCVPrompt(profile.value, reference);
    if (output.value !== prompt) {
      output.value = prompt;
      copyStatus.textContent = "";
    }
    copy.disabled = loading || !prompt;
  }

  function renderControls() {
    fileInput.disabled = sample.disabled = loading;
    clear.disabled = loading || !reference;
    remember.disabled = loading || !reference || reference.sample;
    renderPrompt();
  }

  function saveTopics() {
    try {
      if (remember.checked && reference && !reference.sample) {
        localStorage.setItem(storageKey, JSON.stringify(reference.topics));
      } else {
        localStorage.removeItem(storageKey);
      }
      return "";
    } catch {
      remember.checked = false;
      return " Browser storage could not be updated.";
    }
  }

  async function replaceReference(readText, isSample) {
    loading = true;
    referenceStatus.textContent = "Reading CV on this device...";
    renderControls();
    try {
      const text = await readText();
      if (!text.trim()) throw new Error("No readable text found. Choose a text-based PDF or .txt file.");
      reference = { topics: detectCVTopics(text), sample: isSample };
      if (isSample) remember.checked = false;
      const status = isSample ? "Fictional sample selected. Attach your own CV in the AI chat."
        : reference.topics.length ? "CV reference updated. The prompt uses the new topic matches."
          : "CV reference updated. No matching dental topics were found; attach the CV in your AI chat.";
      referenceStatus.textContent = status + saveTopics();
    } catch (error) {
      const detail = error.name === "PasswordException" ? "Choose an unlocked PDF or a .txt file." : error.message;
      referenceStatus.textContent = `Could not read the CV. ${detail}${reference ? " Previous reference kept." : ""}`;
    } finally {
      fileInput.value = "";
      loading = false;
      renderControls();
    }
  }

  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (!file) return;
    void replaceReference(async () => {
      if (file.size > 5 * 1024 * 1024) throw new Error("Choose a file up to 5 MB.");
      if (/\.pdf$/i.test(file.name)) return extractPDF(await file.arrayBuffer());
      if (/\.txt$/i.test(file.name)) return file.text();
      throw new Error("Choose a text-based PDF or .txt file.");
    }, false);
  });
  sample.addEventListener("click", () => {
    void replaceReference(async () => {
      const response = await fetch(samplePDF, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error("The fictional sample could not be downloaded.");
      return extractPDF(await response.arrayBuffer());
    }, true);
  });
  remember.addEventListener("change", () => {
    const saved = remember.checked;
    const error = saveTopics();
    referenceStatus.textContent = error.trim() || (saved
      ? "Only broad CV topics are remembered in this browser."
      : "Saved topics removed. The reference stays loaded until you leave the page.");
  });
  clear.addEventListener("click", () => {
    reference = null;
    remember.checked = false;
    referenceStatus.textContent = "CV reference cleared." + saveTopics();
    renderControls();
  });
  profile.addEventListener("input", renderPrompt);
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(output.value);
      copyStatus.textContent = "Prompt copied. Paste it into your AI chat and attach your CV there.";
    } catch {
      output.focus();
      output.select();
      copyStatus.textContent = "Could not copy automatically. Copy the selected prompt manually.";
    }
  });

  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (Array.isArray(saved)) {
      reference = { topics: validCVTopics(saved), sample: false };
      remember.checked = true;
      referenceStatus.textContent = "Using CV topics remembered in this browser. Choose a new file to replace them.";
    }
  } catch {
    referenceStatus.textContent = "Saved CV topics could not be loaded. Choose a local CV to use as reference.";
  }
  renderControls();

  return (job) => {
    const summary = `${job.title}\nEmployer: ${job.employer}\nLocation: ${locationLabel(job)}`;
    if (profile.value !== summary && !profile.value.startsWith(`${summary}\n`)) {
      profile.value = `${summary}\n\n`;
      renderPrompt();
    }
    window.location.hash = "cv";
    $("cv").scrollIntoView();
    $("cv-title").focus({ preventScroll: true });
  };
}
