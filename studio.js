const $ = (id) => document.getElementById(id);
const input = $("capture-files");
const settings = {
  video: { accept: ".mp4,.mov,.m4v,.mkv,.webm", min: 1, max: 1, maximum: 1024, total: 1024,
    label: "Choose or drop your video", hint: "One MP4, MOV, M4V, MKV or WebM · up to 1 GB" },
  photos: { accept: ".jpg,.jpeg,.png,.webp", min: 12, max: 180, maximum: 30, total: 500,
    label: "Choose or drop your photos", hint: "12–180 JPEG, PNG or WebP photos · up to 500 MB total" },
};
const stages = {
  waiting: "Waiting for capture", running: "Starting worker", sampling: "Checking and sampling frames",
  tracking: "Matching views and tracking cameras", meshing: "Reconstructing the 3D surface",
  texturing: "Applying textures and measuring coverage", packaging: "Packaging the tour",
  complete: "Ready to review", rejected: "Capture needs improvement", failed: "Reconstruction stopped",
};
const progress = { sampling: 1, tracking: 2, meshing: 3, texturing: 4, packaging: 5 };
const labels = {
  waiting: "Waiting", running: "Processing", complete: "Review", rejected: "Recapture", failed: "Stopped",
};
let kind = "video";
let selected = [];
let activeId;
let jobs = [];
let posting = false;
let pending;
let poll;

async function request(path, options) {
  const response = await fetch(path, { cache: "no-store", ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "The local worker returned an error.");
  return data;
}

function chooseMode(mode) {
  kind = mode;
  pending = undefined;
  selected = [];
  input.value = "";
  input.accept = settings[kind].accept;
  input.multiple = kind === "photos";
  $("video-mode").setAttribute("aria-pressed", String(kind === "video"));
  $("photo-mode").setAttribute("aria-pressed", String(kind === "photos"));
  $("file-hint").textContent = settings[kind].hint;
  showSelection();
}

function showSelection(error = "") {
  $("selected-label").textContent = selected.length
    ? kind === "video" ? selected[0].name : `${selected.length} photos selected`
    : settings[kind].label;
  $("upload-status").textContent = error;
  updateControls();
}

function useFiles(files) {
  if (posting) return;
  pending = undefined;
  const chosen = [...files];
  const cap = settings[kind];
  const extensions = cap.accept.split(",");
  const mib = 1024 * 1024;
  const invalid = chosen.some(({ name, size }) => {
    const extension = name.slice(name.lastIndexOf(".")).toLowerCase();
    return !extensions.includes(extension) || size <= 0 || size > cap.maximum * mib;
  });
  const count = chosen.length;
  const total = chosen.reduce((sum, file) => sum + file.size, 0);
  if (!count || count < cap.min || count > cap.max || invalid || total > cap.total * mib) {
    selected = [];
    input.value = "";
    showSelection(`Choose ${cap.hint.toLowerCase()}.`);
    return;
  }
  selected = chosen;
  showSelection();
}

function updateControls() {
  $("create").disabled = posting || !selected.length || jobs.some((job) => job.state === "running");
  input.disabled = posting;
  $("name").disabled = posting;
  $("video-mode").disabled = posting;
  $("photo-mode").disabled = posting;
}

function upload(job, index, file, notify) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `./api/jobs/${job}/files/${index}`);
    xhr.upload.onprogress = ({ loaded }) => notify(loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      try { reject(new Error(JSON.parse(xhr.responseText).error)); }
      catch { reject(new Error("The local worker could not receive the file.")); }
    };
    xhr.onerror = () => reject(new Error("The local connection was interrupted. Try again to resume."));
    xhr.send(file);
  });
}

function detailLine(name, text) {
  const row = document.createElement("div");
  const term = document.createElement("dt");
  const value = document.createElement("dd");
  term.textContent = name;
  value.textContent = text;
  row.append(term, value);
  return row;
}

function render() {
  if (!jobs.some((job) => job.id === activeId)) activeId = jobs[0]?.id;
  const list = $("job-list");
  const focused = list.contains(document.activeElement) ? document.activeElement.dataset.job : "";
  list.replaceChildren(...jobs.map((job) => {
    const button = document.createElement("button");
    button.className = "job-select";
    button.type = "button";
    button.dataset.job = job.id;
    button.setAttribute("aria-current", String(job.id === activeId));
    const name = document.createElement("span");
    const state = document.createElement("small");
    name.textContent = job.name;
    state.textContent = labels[job.state] || job.state;
    button.append(name, state);
    button.onclick = () => {
      activeId = job.id;
      $("log-panel").open = false;
      $("job-log").textContent = "";
      render();
    };
    return button;
  }));
  if (focused) [...list.children].find((button) => button.dataset.job === focused)?.focus();
  const selectedJob = jobs.find((job) => job.id === activeId);
  $("job-view").hidden = !selectedJob;
  $("queue-description").textContent = jobs.length
    ? "Select a job to see processing and quality results."
    : "Your first scan will appear here.";
  if (!selectedJob) return;
  const job = selectedJob;
  $("job-name").textContent = job.name;
  $("job-state").textContent = stages[job.state === "running" ? job.stage : job.state] || stages.running;
  $("job-progress").hidden = job.state !== "running";
  $("job-progress").value = progress[job.stage] || 0;
  $("job-message").textContent = job.message || (job.state === "waiting"
    ? `${job.received} of ${job.files} files received.`
    : job.state === "complete" ? "Review the room for gaps and texture distortions before sharing." : "");
  const m = job.metrics;
  const rows = [];
  if (m.resolution) rows.push(detailLine("Frame size", m.resolution));
  if (m.sampled) rows.push(detailLine("Sampled frames", String(m.sampled)));
  if (m.registered) rows.push(detailLine("Aligned in one scan", `${m.registered} / ${m.sampled}`));
  if (m.components > 1) rows.push(detailLine("Connected groups", String(m.components)));
  if (Number.isFinite(m.coverage)) rows.push(detailLine("Median tested view coverage", `${Math.round(m.coverage * 100)}%`));
  if (m.triangles) rows.push(detailLine("Textured triangles", m.triangles.toLocaleString()));
  $("metrics").replaceChildren(...rows);
  $("result-actions").hidden = job.state !== "complete";
  $("view-result").href = `./viewer.html?job=${job.id}`;
  $("download-result").href = `./api/jobs/${job.id}/result.glb?download=1`;
  $("log-panel").hidden = job.state === "waiting";
}

async function refresh() {
  clearTimeout(poll);
  try {
    jobs = await request("./api/jobs");
    render();
    updateControls();
    if (jobs.some((job) => job.state === "running")) poll = setTimeout(refresh, 1800);
  } catch {
    $("queue-description").textContent = "Lost the local worker connection. Waiting to reconnect.";
    poll = setTimeout(refresh, 4000);
  }
}

$("capture-form").onsubmit = async (event) => {
  event.preventDefault();
  if (posting || !selected.length) return;
  posting = true;
  updateControls();
  try {
    if (!pending) {
      $("upload-status").textContent = "Preparing local job…";
      const job = await request("./api/jobs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: $("name").value, kind, files: selected.map(({ name, size }) => ({ name, size })),
        }),
      });
      pending = { id: job.id, index: 0 };
    }
    activeId = pending.id;
    while (pending.index < selected.length) {
      const i = pending.index;
      const file = selected[i];
      const show = (loaded) => {
        $("upload-status").textContent = `Copying file ${i + 1} of ${selected.length} · ${Math.floor(loaded / file.size * 100)}%`;
      };
      show(0);
      await upload(pending.id, i, file, show);
      pending.index++;
    }
    try {
      await request(`./api/jobs/${pending.id}/start`, { method: "POST" });
    } catch (error) {
      const state = await request(`./api/jobs/${pending.id}`).then((job) => job.state, () => "waiting");
      if (state === "waiting") throw error;
    }
    selected = [];
    pending = undefined;
    input.value = "";
    showSelection();
  } catch (error) {
    $("upload-status").textContent = error.message || "The scan could not start.";
  } finally {
    posting = false;
    await refresh();
    updateControls();
  }
};

$("log-panel").addEventListener("toggle", async () => {
  if (!$("log-panel").open || !activeId) return;
  const job = activeId;
  const output = $("job-log");
  output.textContent = "Loading log…";
  try {
    const response = await fetch(`./api/jobs/${job}/log`, { cache: "no-store" });
    if (job === activeId) output.textContent = response.ok ? await response.text() : "No log is available yet.";
  } catch {
    if (job === activeId) output.textContent = "Could not load the local log.";
  }
});

$("video-mode").onclick = () => chooseMode("video");
$("photo-mode").onclick = () => chooseMode("photos");
input.onchange = () => useFiles(input.files);
for (const name of ["dragover", "dragleave", "drop"]) {
  $("drop").addEventListener(name, (event) => {
    event.preventDefault();
    $("drop").classList.toggle("dragging", name === "dragover" && !posting);
    if (name === "drop") useFiles(event.dataTransfer.files);
  });
}
$("copy-command").onclick = async () => {
  const button = $("copy-command");
  try {
    await navigator.clipboard.writeText("docker compose up --build");
    button.textContent = "Copied";
    setTimeout(() => { button.textContent = "Copy"; }, 1800);
  } catch {
    button.textContent = "Select command";
  }
};

async function boot() {
  const ready = await request("./api/health", { signal: AbortSignal.timeout(4000) })
    .then((health) => health.service === "vyral-studio", () => false);
  $("connection").classList.toggle("ready", ready);
  $("connection").lastChild.textContent = ready ? " Local worker ready" : " Hosted viewer";
  $("capture-form").hidden = !ready;
  $("setup").hidden = ready;
  $("offline-note").hidden = ready;
  if (ready) await refresh();
  else $("queue-description").textContent = "Start the local worker to build from your footage.";
}
boot();
