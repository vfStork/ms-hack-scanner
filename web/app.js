import { initViewports, showSingle, showSideBySide, setWireframe } from "./viewer.js";

// ── State ─────────────────────────────────────────────────────────────
let twins = [];
let activeTwinId = null;
let activeVersion = null;
let pendingFile = null;       // file waiting for name confirmation
let wireframeOn = false;

// ── DOM refs ──────────────────────────────────────────────────────────
const $list          = document.getElementById("twin-list");
const $fileInput     = document.getElementById("file-input");
const $versionSelect = document.getElementById("version-select");
const $variantSelect = document.getElementById("variant-select");
const $btnNewUpload  = document.getElementById("btn-new-upload");
const $btnRescan     = document.getElementById("btn-rescan");
const $btnClean      = document.getElementById("btn-clean");
const $btnEnrich     = document.getElementById("btn-enrich");
const $btnCompare    = document.getElementById("btn-compare");
const $btnWireframe  = document.getElementById("btn-wireframe");
const $btnInfo       = document.getElementById("btn-info");
const $btnCloseInfo  = document.getElementById("btn-close-info");
const $infoPanel     = document.getElementById("info-panel");
const $metaContent   = document.getElementById("metadata-content");
const $diffStats     = document.getElementById("diff-stats-section");
const $diffContent   = document.getElementById("diff-stats-content");
const $changelog     = document.getElementById("changelog-section");
const $labelA        = document.getElementById("label-a");
const $labelB        = document.getElementById("label-b");
const $emptyState    = document.getElementById("empty-state-vp");
const $loadingEl     = document.getElementById("loading");
const $loadingTitle  = document.getElementById("loading-title");
const $loadingStep   = document.getElementById("loading-step");
const $modalUpload   = document.getElementById("modal-upload");
const $modalCompare  = document.getElementById("modal-compare");
const $nameInput     = document.getElementById("twin-name-input");
const $cmpVa         = document.getElementById("cmp-va");
const $cmpVb         = document.getElementById("cmp-vb");
const $cmpCleaned    = document.getElementById("cmp-use-cleaned");
const $container     = document.getElementById("viewport-container");
const $dropZone      = document.getElementById("drop-zone");

// ── Toast system ──────────────────────────────────────────────────────
const $toastContainer = document.getElementById("toast-container");

function toast(message, type = "info", duration = 4500) {
  const icons = { success: "✓", error: "✕", info: "ℹ" };
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.innerHTML = `
    <span class="toast-icon">${icons[type]}</span>
    <span>${esc(message)}</span>
    <button class="toast-close" aria-label="Dismiss">✕</button>
  `;
  el.querySelector(".toast-close").onclick = () => el.remove();
  $toastContainer.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

// ── Loading helpers ───────────────────────────────────────────────────
function loading(on, title = "Processing…", step = "") {
  $loadingEl.classList.toggle("active", on);
  $loadingTitle.textContent = title;
  $loadingStep.textContent = step;
}

function loadingStep(step) {
  $loadingStep.textContent = step;
}

// ── API helper ────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    throw new Error(body || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Escape HTML ───────────────────────────────────────────────────────
function esc(s) {
  const d = document.createElement("div");
  d.textContent = String(s);
  return d.innerHTML;
}

// ── Empty state ───────────────────────────────────────────────────────
function setEmptyState(visible) {
  $emptyState.classList.toggle("hidden", !visible);
}

// ── Twin list ─────────────────────────────────────────────────────────
async function refreshList() {
  twins = await api("/api/twins");
  renderList();
  if (twins.length === 0) setEmptyState(true);
}

function renderList() {
  $list.innerHTML = "";
  if (twins.length === 0) {
    $list.innerHTML = `<div style="padding:16px;font-size:12px;color:var(--text-muted);text-align:center;line-height:1.6;">No twins yet.<br>Upload a scan to get started.</div>`;
    return;
  }
  for (const t of twins) {
    const isClean    = t.versions.some((v) => v.is_cleaned);
    const isEnriched = Object.keys(t.metadata).length > 0;
    const isCompared = t.changelog.length > 0;

    const badges = [
      isClean    ? `<span class="badge badge-clean">clean</span>`    : "",
      isEnriched ? `<span class="badge badge-enriched">AI</span>`    : "",
      isCompared ? `<span class="badge badge-compared">diff</span>`  : "",
    ].join("");

    const el = document.createElement("div");
    el.className = "twin-item" + (t.id === activeTwinId ? " active" : "");
    el.innerHTML = `
      <div class="twin-item-name">${esc(t.name)}</div>
      <div class="twin-item-meta">
        <span>${t.versions.length} version${t.versions.length !== 1 ? "s" : ""}</span>
        <span style="color:var(--border-light)">·</span>
        <span>${t.id.slice(0, 8)}</span>
        ${badges}
      </div>
    `;
    el.onclick = () => selectTwin(t.id);
    $list.appendChild(el);
  }
}

// ── Select twin ───────────────────────────────────────────────────────
async function selectTwin(id) {
  activeTwinId = id;
  setEmptyState(false);

  const twin = await api(`/api/twins/${id}`);
  renderList();
  populateVersions(twin);
  populateInfo(twin);

  const latest = twin.versions[twin.versions.length - 1];
  activeVersion = latest.version;
  $versionSelect.value = latest.version;

  $btnRescan.disabled   = false;
  $btnClean.disabled    = false;
  $btnEnrich.disabled   = false;
  $btnCompare.disabled  = twin.versions.length < 2;
  $btnWireframe.disabled = false;

  await loadModel(twin, latest.version, $variantSelect.value);
}

function populateVersions(twin) {
  $versionSelect.innerHTML = "";
  $versionSelect.disabled = false;
  for (const v of twin.versions) {
    const opt = document.createElement("option");
    opt.value = v.version;
    opt.textContent = `v${v.version}${v.is_cleaned ? " ✓" : ""}`;
    $versionSelect.appendChild(opt);
  }
}

// ── Info panel ────────────────────────────────────────────────────────
function populateInfo(twin) {
  // Metadata cards
  const meta = twin.metadata;
  if (Object.keys(meta).length === 0) {
    $metaContent.innerHTML = `<span style="color:var(--text-muted);font-size:12px;">Not enriched yet. Click "Enrich AI".</span>`;
  } else {
    const cardDefs = [
      { key: "material",        icon: "⚙️",  label: "Material" },
      { key: "component_class", icon: "🔩", label: "Component Class" },
      { key: "lifespan_years",  icon: "⏳", label: "Est. Lifespan" },
      { key: "confidence",      icon: "📊", label: "Confidence" },
    ];
    const cards = cardDefs
      .filter(({ key }) => meta[key] !== undefined)
      .map(({ key, icon, label }) => {
        const val = key === "lifespan_years" ? `${meta[key]} years` : meta[key];
        return `<div class="meta-card">
          <div class="meta-icon">${icon}</div>
          <div class="meta-text">
            <div class="meta-label">${label}</div>
            <div class="meta-value">${esc(String(val))}</div>
          </div>
        </div>`;
      })
      .join("");

    const reasoning = meta.reasoning
      ? `<div class="meta-reasoning">💬 ${esc(meta.reasoning)}</div>`
      : "";

    $metaContent.innerHTML = cards + reasoning;
  }

  // Diff stats from latest changelog entry
  const latest = twin.changelog[twin.changelog.length - 1];
  if (latest && latest.diff_stats) {
    $diffStats.style.display = "block";
    renderDiffStats(latest.diff_stats);
  } else {
    $diffStats.style.display = "none";
  }

  // Changelog entries
  if (twin.changelog.length === 0) {
    $changelog.innerHTML = `<span style="color:var(--text-muted);font-size:12px;">No comparisons yet.</span>`;
  } else {
    $changelog.innerHTML = [...twin.changelog].reverse().map((c) => `
      <div class="changelog-entry">
        <div class="changelog-vers">v${c.version_a} → v${c.version_b}</div>
        <div class="changelog-time">${new Date(c.timestamp).toLocaleString()}</div>
        <div class="changelog-desc">${esc(c.description)}</div>
      </div>
    `).join("");
  }
}

function renderDiffStats(stats) {
  const mean = stats.mean_distance ?? 0;
  const severity = mean > 0.05 ? "warn" : mean > 0.01 ? "info" : "ok";

  const rows = [
    { label: "Mean distance",   value: mean.toFixed(5),              cls: severity },
    { label: "Max distance",    value: (stats.max_distance ?? 0).toFixed(5),  cls: "info" },
    { label: "Std deviation",   value: (stats.std_distance ?? 0).toFixed(5),  cls: "info" },
    { label: "Volume delta",    value: fmt_vol(stats.volume_delta),            cls: (stats.volume_delta ?? 0) > 0 ? "ok" : "warn" },
  ];

  $diffContent.innerHTML = rows.map(({ label, value, cls }) =>
    `<div class="stat-card ${cls}">
      <span class="stat-label">${label}</span>
      <span class="stat-value">${value}</span>
    </div>`
  ).join("");
}

function fmt_vol(v) {
  if (v == null) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(5)} m³`;
}

// ── Load model into viewport ──────────────────────────────────────────
async function loadModel(twin, version, variant) {
  const v = twin.versions.find((vv) => vv.version === version);
  if (!v) return;
  if (variant === "clean" && !v.is_cleaned) variant = "raw";
  const url = `/api/twins/${twin.id}/versions/${version}/model?variant=${variant}`;
  $labelA.textContent = `v${version} · ${variant}`;
  await showSingle(url);
}

// ── Upload flow ───────────────────────────────────────────────────────
function triggerUpload() {
  pendingFile = null;
  $fileInput.value = "";
  $fileInput.click();
}

$btnNewUpload.onclick = triggerUpload;
document.getElementById("btn-empty-upload").onclick = triggerUpload;

$fileInput.onchange = () => {
  const file = $fileInput.files[0];
  if (!file) return;
  pendingFile = file;
  // Pre-fill name with filename (no extension)
  $nameInput.value = file.name.replace(/\.[^.]+$/, "");
  $nameInput.select();
  openModal($modalUpload);
};

document.getElementById("modal-upload-confirm").onclick = async () => {
  if (!pendingFile) return;
  closeModal($modalUpload);
  const name = $nameInput.value.trim() || pendingFile.name;
  loading(true, "Uploading scan…", "Registering new digital twin");

  const form = new FormData();
  form.append("file", pendingFile);
  form.append("name", name);

  try {
    const twin = await api("/api/upload", { method: "POST", body: form });
    activeTwinId = twin.id;
    await refreshList();
    await selectTwin(activeTwinId);
    toast(`Twin "${name}" created`, "success");
  } catch (e) {
    toast("Upload failed: " + e.message, "error");
  } finally {
    loading(false);
    pendingFile = null;
    $fileInput.value = "";
  }
};

document.getElementById("modal-upload-cancel").onclick = () => {
  closeModal($modalUpload);
  pendingFile = null;
  $fileInput.value = "";
};

// ── Re-scan flow ──────────────────────────────────────────────────────
$btnRescan.onclick = () => {
  if (!activeTwinId) return;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".ply,.obj,.stl";
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    loading(true, "Uploading re-scan…", "Adding new version");
    const form = new FormData();
    form.append("file", file);
    try {
      await api(`/api/twins/${activeTwinId}/rescan`, { method: "POST", body: form });
      await refreshList();
      await selectTwin(activeTwinId);
      toast("New scan version added", "success");
    } catch (e) {
      toast("Re-scan failed: " + e.message, "error");
    } finally {
      loading(false);
    }
  };
  input.click();
};

// ── Drag-and-drop ─────────────────────────────────────────────────────
$container.addEventListener("dragover", (e) => {
  e.preventDefault();
  $dropZone.classList.add("visible");
});

$container.addEventListener("dragleave", (e) => {
  if (!$container.contains(e.relatedTarget)) {
    $dropZone.classList.remove("visible");
  }
});

$container.addEventListener("drop", (e) => {
  e.preventDefault();
  $dropZone.classList.remove("visible");
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const ext = file.name.split(".").pop().toLowerCase();
  if (!["ply", "obj", "stl"].includes(ext)) {
    toast(`Unsupported format: .${ext}`, "error");
    return;
  }
  pendingFile = file;
  $nameInput.value = file.name.replace(/\.[^.]+$/, "");
  $nameInput.select();
  openModal($modalUpload);
});

// ── Clean ─────────────────────────────────────────────────────────────
$btnClean.onclick = async () => {
  if (!activeTwinId || !activeVersion) return;
  loading(true, "Cleaning mesh…", "Removing outliers — this may take 30–60 s");
  try {
    await api(`/api/twins/${activeTwinId}/versions/${activeVersion}/clean`, {
      method: "POST",
    });
    $variantSelect.value = "clean";
    const twin = await api(`/api/twins/${activeTwinId}`);
    await refreshList();
    populateVersions(twin);
    populateInfo(twin);
    await loadModel(twin, activeVersion, "clean");
    toast(`v${activeVersion} cleaned`, "success");
  } catch (e) {
    toast("Clean failed: " + e.message, "error");
  } finally {
    loading(false);
  }
};

// ── Enrich ────────────────────────────────────────────────────────────
$btnEnrich.onclick = async () => {
  if (!activeTwinId) return;
  loading(true, "AI Enrichment…", "Analysing geometry with Azure OpenAI");
  try {
    const twin = await api(`/api/twins/${activeTwinId}/enrich`, { method: "POST" });
    await refreshList();
    populateInfo(twin);
    $infoPanel.classList.add("visible");
    toast("Enrichment complete", "success");
  } catch (e) {
    toast("Enrich failed: " + e.message, "error");
  } finally {
    loading(false);
  }
};

// ── Compare ───────────────────────────────────────────────────────────
$btnCompare.onclick = async () => {
  if (!activeTwinId) return;
  const twin = await api(`/api/twins/${activeTwinId}`);
  if (twin.versions.length < 2) {
    toast("Need at least 2 versions to compare", "info");
    return;
  }

  // Populate compare modal selects
  $cmpVa.innerHTML = "";
  $cmpVb.innerHTML = "";
  for (const v of twin.versions) {
    const label = `v${v.version}${v.is_cleaned ? " ✓" : ""}`;
    $cmpVa.innerHTML += `<option value="${v.version}">${label}</option>`;
    $cmpVb.innerHTML += `<option value="${v.version}">${label}</option>`;
  }
  // Default: last-2 vs last
  $cmpVa.value = twin.versions[twin.versions.length - 2].version;
  $cmpVb.value = twin.versions[twin.versions.length - 1].version;

  openModal($modalCompare);
};

document.getElementById("modal-compare-confirm").onclick = async () => {
  closeModal($modalCompare);
  const va = parseInt($cmpVa.value);
  const vb = parseInt($cmpVb.value);
  if (va === vb) { toast("Please select two different versions", "info"); return; }
  const useCleaned = $cmpCleaned.checked;

  loading(true, `Comparing v${va} ↔ v${vb}…`, "Running ICP alignment");
  try {
    // Simulate step progression while waiting for the API
    const steps = [
      "Computing per-vertex distances…",
      "Generating heatmap…",
      "Requesting AI change description…",
    ];
    let si = 0;
    const stepTimer = setInterval(() => {
      if (si < steps.length) loadingStep(steps[si++]);
    }, 8000);

    const result = await api("/api/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ twin_id: activeTwinId, version_a: va, version_b: vb, use_cleaned: useCleaned }),
    });
    clearInterval(stepTimer);

    const urlA = `/api/twins/${activeTwinId}/versions/${va}/model?variant=${useCleaned ? "clean" : "raw"}`;
    $labelA.textContent = `v${va} · ${useCleaned ? "cleaned" : "raw"}`;
    $labelB.textContent = `v${vb} · heatmap`;

    await showSideBySide(urlA, result.heatmap_url);

    const twin = await api(`/api/twins/${activeTwinId}`);
    await refreshList();
    populateInfo(twin);
    $infoPanel.classList.add("visible");

    toast(`Comparison done — mean Δ: ${result.diff.mean_distance.toFixed(4)}`, "success");
  } catch (e) {
    toast("Compare failed: " + e.message, "error");
  } finally {
    loading(false);
  }
};

document.getElementById("modal-compare-cancel").onclick = () => closeModal($modalCompare);

// ── Version / variant selectors ───────────────────────────────────────
$versionSelect.onchange = async () => {
  if (!activeTwinId) return;
  activeVersion = parseInt($versionSelect.value);
  const twin = await api(`/api/twins/${activeTwinId}`);
  await loadModel(twin, activeVersion, $variantSelect.value);
};

$variantSelect.onchange = async () => {
  if (!activeTwinId || !activeVersion) return;
  const twin = await api(`/api/twins/${activeTwinId}`);
  await loadModel(twin, activeVersion, $variantSelect.value);
};

// ── Wireframe toggle ──────────────────────────────────────────────────
$btnWireframe.onclick = () => {
  wireframeOn = !wireframeOn;
  setWireframe(wireframeOn);
  $btnWireframe.classList.toggle("active", wireframeOn);
};

// ── Info panel ────────────────────────────────────────────────────────
$btnInfo.onclick = () => $infoPanel.classList.toggle("visible");
$btnCloseInfo.onclick = () => $infoPanel.classList.remove("visible");

// ── Modal helpers ─────────────────────────────────────────────────────
function openModal(modal) { modal.classList.add("open"); }
function closeModal(modal) { modal.classList.remove("open"); }

// Close modals on backdrop click or Escape
document.querySelectorAll(".modal-overlay").forEach((overlay) => {
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal(overlay);
  });
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.querySelectorAll(".modal-overlay.open").forEach(closeModal);
  }
});

// Confirm upload on Enter in name input
$nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("modal-upload-confirm").click();
});

// ── Init ──────────────────────────────────────────────────────────────
initViewports();
refreshList();
