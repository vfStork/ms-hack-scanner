import { initViewports, showSingle, showSideBySide, setWireframe, getViewportA, getViewportB, setRotation, setPositionOffset, resetTransform } from "./viewer.js";

// ── State ─────────────────────────────────────────────────────────────
let twins = [];
let activeTwinId = null;
let activeTwin = null;        // full twin object from API (includes transform)
let activeVersion = null;
let pendingFile = null;       // file waiting for name confirmation
let wireframeOn = false;
// Tracks the last comparison so the vp-b toggle can switch between heatmap and model B
let lastCompare = null;       // { urlHeatmap, urlModelB, va, vb, showingHeatmap }

// ── DOM refs ──────────────────────────────────────────────────────────
const $list          = document.getElementById("twin-list");
const $fileInput     = document.getElementById("file-input");
const $versionSelect = document.getElementById("version-select");
const $variantSelect = document.getElementById("variant-select");
const $btnNewUpload  = document.getElementById("btn-new-upload");
const $btnRescan     = document.getElementById("btn-rescan");
const $btnClean      = document.getElementById("btn-clean");
const $btnCrop       = document.getElementById("btn-crop");
const $btnEnrich     = document.getElementById("btn-enrich");
const $btnCompare    = document.getElementById("btn-compare");
const $btnWireframe  = document.getElementById("btn-wireframe");
const $btnTransform  = document.getElementById("btn-transform");
const $transformPanel = document.getElementById("transform-panel");
const $btnInfo       = document.getElementById("btn-info");
const $btnCloseInfo  = document.getElementById("btn-close-info");
const $infoPanel     = document.getElementById("info-panel");
const $metaContent   = document.getElementById("metadata-content");
const $diffStats     = document.getElementById("diff-stats-section");
const $diffContent   = document.getElementById("diff-stats-content");
const $changelog     = document.getElementById("changelog-section");
const $labelA        = document.getElementById("label-a");
const $labelB        = document.getElementById("label-b");
const $btnVpBToggle  = document.getElementById("btn-vp-b-toggle");
const $heatmapLegend = document.getElementById("heatmap-legend");
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
    const err = new Error(body || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
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
  activeTwin = twin;
  renderList();
  populateVersions(twin);
  populateInfo(twin);

  const latest = twin.versions[twin.versions.length - 1];
  activeVersion = latest.version;
  $versionSelect.value = latest.version;

  $btnRescan.disabled   = false;
  $btnClean.disabled    = false;
  $btnCrop.disabled     = false;
  $btnEnrich.disabled   = false;
  $btnCompare.disabled  = twin.versions.length < 2;
  $btnWireframe.disabled = false;
  $btnTransform.disabled = false;

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
  if (variant === "clean"   && !v.is_cleaned) variant = "raw";
  if (variant === "cropped" && !v.is_cropped) variant = "raw";
  const url = `/api/twins/${twin.id}/versions/${version}/model?variant=${variant}`;
  $labelA.textContent = `v${version} · ${variant}`;
  // Hide the compare toggle when switching back to single-model view
  $btnVpBToggle.style.display = "none";
  lastCompare = null;
  await showSingle(url);
  applyTwinTransform();
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
  await runClean(false);
};

async function runClean(force) {
  const url = `/api/twins/${activeTwinId}/versions/${activeVersion}/clean${force ? "?force=true" : ""}`;
  loading(true, "Cleaning mesh…", "Removing outliers — this may take 30–60 s");
  try {
    await api(url, { method: "POST" });
    $variantSelect.value = "clean";
    const twin = await api(`/api/twins/${activeTwinId}`);
    await refreshList();
    populateVersions(twin);
    populateInfo(twin);
    await loadModel(twin, activeVersion, "clean");
    toast(`v${activeVersion} cleaned`, "success");
  } catch (e) {
    if (e.status === 409) {
      loading(false);
      const confirmed = confirm(
        `Version ${activeVersion} has already been cleaned.\nReclean it? This will overwrite the existing result.`
      );
      if (confirmed) await runClean(true);
      return;
    }
    toast("Clean failed: " + e.message, "error");
  } finally {
    loading(false);
  }
}

// ── Crop — draw-to-cut ────────────────────────────────────────────────
const $cropOverlay    = document.getElementById("crop-overlay");
const $cropDrawHint   = document.getElementById("crop-draw-hint");
const $cropConfirmBar = document.getElementById("crop-confirm-bar");
const $cropLabel      = document.getElementById("crop-confirm-label");
const $btnCropApply   = document.getElementById("btn-crop-apply");
const $btnCropFlip    = document.getElementById("btn-crop-flip");
const $btnCropRedraw  = document.getElementById("btn-crop-redraw");
const $btnCropCancel  = document.getElementById("btn-crop-cancel");

let _cropPlane = null;   // { pointOrig, normalOrig } — current drawn plane
let _drawStart = null;   // { x, y } in canvas-relative pixels

function _syncOverlaySize() {
  $cropOverlay.width  = $cropOverlay.offsetWidth;
  $cropOverlay.height = $cropOverlay.offsetHeight;
}

function _drawCutLine(x1, y1, x2, y2) {
  _syncOverlaySize();
  const ctx = $cropOverlay.getContext("2d");
  ctx.clearRect(0, 0, $cropOverlay.width, $cropOverlay.height);

  // Dashed cut line
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = "#4a7fc1";
  ctx.lineWidth = 2.5;
  ctx.setLineDash([7, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Endpoints
  [[ x1, y1 ], [ x2, y2 ]].forEach(([x, y]) => {
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#4a7fc1";
    ctx.fill();
  });

  // Arrowhead at end
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - 14 * Math.cos(angle - 0.4), y2 - 14 * Math.sin(angle - 0.4));
  ctx.lineTo(x2 - 14 * Math.cos(angle + 0.4), y2 - 14 * Math.sin(angle + 0.4));
  ctx.closePath();
  ctx.fillStyle = "#4a7fc1";
  ctx.fill();
}

function _clearOverlay() {
  _syncOverlaySize();
  $cropOverlay.getContext("2d").clearRect(0, 0, $cropOverlay.width, $cropOverlay.height);
}

function _enterDrawMode() {
  _cropPlane = null;
  _syncOverlaySize();
  $cropOverlay.classList.add("draw-active");
  $cropDrawHint.style.display = "block";
  $cropConfirmBar.classList.add("visible");
  $cropLabel.textContent = "Draw a line across the model to define the cut";
  [$btnCropApply, $btnCropFlip, $btnCropRedraw].forEach((b) => (b.disabled = true));
  getViewportA().controls.enabled = false;
}

function _exitDrawMode() {
  $cropOverlay.classList.remove("draw-active");
  $cropDrawHint.style.display = "none";
  $cropConfirmBar.classList.remove("visible");
  _clearOverlay();
  _cropPlane = null;
  _drawStart = null;
  getViewportA().controls.enabled = true;
  getViewportA().clearClipping();
}

// Mouse events on the overlay
$cropOverlay.addEventListener("mousedown", (e) => {
  const r = $cropOverlay.getBoundingClientRect();
  _drawStart = { x: e.clientX - r.left, y: e.clientY - r.top };
  _clearOverlay();
  _cropPlane = null;
  [$btnCropApply, $btnCropFlip, $btnCropRedraw].forEach((b) => (b.disabled = true));
  $cropLabel.textContent = "Release to set the cut";
  getViewportA().clearClipping();
});

$cropOverlay.addEventListener("mousemove", (e) => {
  if (!_drawStart) return;
  const r = $cropOverlay.getBoundingClientRect();
  _drawCutLine(_drawStart.x, _drawStart.y, e.clientX - r.left, e.clientY - r.top);
});

$cropOverlay.addEventListener("mouseup", (e) => {
  if (!_drawStart) return;
  const r  = $cropOverlay.getBoundingClientRect();
  const x1 = _drawStart.x, y1 = _drawStart.y;
  const x2 = e.clientX - r.left, y2 = e.clientY - r.top;
  _drawStart = null;

  const dx = x2 - x1, dy = y2 - y1;
  if (Math.sqrt(dx * dx + dy * dy) < 10) {
    _clearOverlay();
    $cropLabel.textContent = "Too short — draw a longer line";
    return;
  }

  _drawCutLine(x1, y1, x2, y2);

  const plane = getViewportA().screenLineToCropPlane(x1, y1, x2, y2);
  if (!plane) { $cropLabel.textContent = "Load a model first"; return; }

  _cropPlane = plane;
  getViewportA().setClippingPlane(plane.pointOrig, plane.normalOrig);
  $cropLabel.textContent = "Preview shown — apply or flip the cut";
  [$btnCropApply, $btnCropFlip, $btnCropRedraw].forEach((b) => (b.disabled = false));
});

$btnCrop.onclick = () => {
  if (!activeTwinId) return;
  _enterDrawMode();
};

$btnCropFlip.onclick = () => {
  if (!_cropPlane) return;
  _cropPlane.normalOrig = _cropPlane.normalOrig.map((v) => -v);
  getViewportA().setClippingPlane(_cropPlane.pointOrig, _cropPlane.normalOrig);
};

$btnCropRedraw.onclick = () => {
  _clearOverlay();
  _cropPlane = null;
  _drawStart = null;
  getViewportA().clearClipping();
  [$btnCropApply, $btnCropFlip, $btnCropRedraw].forEach((b) => (b.disabled = true));
  $cropLabel.textContent = "Draw a line across the model to define the cut";
};

$btnCropCancel.onclick = _exitDrawMode;

$btnCropApply.onclick = async () => {
  if (!_cropPlane || !activeTwinId || !activeVersion) return;
  const plane = _cropPlane;  // save before _exitDrawMode nulls it
  _exitDrawMode();
  loading(true, "Cropping mesh…", "Processing geometry on server");
  try {
    await api(`/api/twins/${activeTwinId}/versions/${activeVersion}/crop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "plane",
        point:  plane.pointOrig,
        normal: plane.normalOrig,
      }),
    });
    $variantSelect.value = "cropped";
    const twin = await api(`/api/twins/${activeTwinId}`);
    await refreshList();
    populateVersions(twin);
    await loadModel(twin, activeVersion, "cropped");
    toast(`v${activeVersion} cropped`, "success");
  } catch (e) {
    toast("Crop failed: " + e.message, "error");
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
    const urlB = `/api/twins/${activeTwinId}/versions/${vb}/model?variant=${useCleaned ? "clean" : "raw"}`;
    $labelA.textContent = `v${va} · ${useCleaned ? "cleaned" : "raw"}`;
    $labelB.textContent = `v${vb} · heatmap`;

    await showSideBySide(urlA, result.heatmap_url);
    applyTwinTransform();

    // Store compare state so the toggle can switch between heatmap and model B
    lastCompare = { urlHeatmap: result.heatmap_url, urlModelB: urlB, va, vb, showingHeatmap: true };
    $btnVpBToggle.textContent = "⇄ Show Model B";
    $btnVpBToggle.classList.remove("active");
    $btnVpBToggle.style.display = "block";
    $heatmapLegend.style.display = "flex";

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

// ── Viewport B toggle (heatmap ↔ model B) ────────────────────────────
$btnVpBToggle.onclick = async () => {
  if (!lastCompare) return;
  const { urlHeatmap, urlModelB, va, vb, showingHeatmap } = lastCompare;
  if (showingHeatmap) {
    // Switch to model B
    await getViewportB().loadGLB(urlModelB);
    $labelB.textContent = `v${vb} · raw`;
    $btnVpBToggle.textContent = "⇄ Show Heatmap";
    $btnVpBToggle.classList.add("active");
    $heatmapLegend.style.display = "none";
    lastCompare.showingHeatmap = false;
  } else {
    // Switch back to heatmap
    await getViewportB().loadGLB(urlHeatmap);
    $labelB.textContent = `v${vb} · heatmap`;
    $btnVpBToggle.textContent = "⇄ Show Model B";
    $btnVpBToggle.classList.remove("active");
    $heatmapLegend.style.display = "flex";
    lastCompare.showingHeatmap = true;
  }
};

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

// ── Transform panel ───────────────────────────────────────────────────
$btnTransform.onclick = () => {
  $transformPanel.classList.toggle("visible");
  $btnTransform.classList.toggle("active", $transformPanel.classList.contains("visible"));
};
document.getElementById("tp-close").onclick = () => {
  $transformPanel.classList.remove("visible");
  $btnTransform.classList.remove("active");
};

// Slider refs
const tpSliders = {
  rotX: document.getElementById("tp-rot-x"),
  rotY: document.getElementById("tp-rot-y"),
  rotZ: document.getElementById("tp-rot-z"),
  posX: document.getElementById("tp-pos-x"),
  posY: document.getElementById("tp-pos-y"),
  posZ: document.getElementById("tp-pos-z"),
};
const tpValues = {
  rotX: document.getElementById("tp-rot-x-val"),
  rotY: document.getElementById("tp-rot-y-val"),
  rotZ: document.getElementById("tp-rot-z-val"),
  posX: document.getElementById("tp-pos-x-val"),
  posY: document.getElementById("tp-pos-y-val"),
  posZ: document.getElementById("tp-pos-z-val"),
};

function syncTransformFromSliders() {
  const rx = parseFloat(tpSliders.rotX.value);
  const ry = parseFloat(tpSliders.rotY.value);
  const rz = parseFloat(tpSliders.rotZ.value);
  tpValues.rotX.textContent = `${rx}°`;
  tpValues.rotY.textContent = `${ry}°`;
  tpValues.rotZ.textContent = `${rz}°`;
  setRotation(rx, ry, rz);

  const px = parseFloat(tpSliders.posX.value);
  const py = parseFloat(tpSliders.posY.value);
  const pz = parseFloat(tpSliders.posZ.value);
  tpValues.posX.textContent = px.toFixed(2);
  tpValues.posY.textContent = py.toFixed(2);
  tpValues.posZ.textContent = pz.toFixed(2);
  setPositionOffset(px, py, pz);

  debouncedSaveTransform();
}

// Debounced save — waits 500ms after last slider change before calling API
let _saveTimer = null;
function debouncedSaveTransform() {
  if (!activeTwinId) return;
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    const body = {
      rot_x: parseFloat(tpSliders.rotX.value),
      rot_y: parseFloat(tpSliders.rotY.value),
      rot_z: parseFloat(tpSliders.rotZ.value),
      pos_x: parseFloat(tpSliders.posX.value),
      pos_y: parseFloat(tpSliders.posY.value),
      pos_z: parseFloat(tpSliders.posZ.value),
    };
    fetch(`/api/twins/${activeTwinId}/transform`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => {});
  }, 500);
}

// Apply stored transform from the active twin to sliders + viewport
function applyTwinTransform() {
  const t = activeTwin?.transform;
  if (!t) { resetSliders(); return; }
  tpSliders.rotX.value = t.rot_x ?? 0;
  tpSliders.rotY.value = t.rot_y ?? 0;
  tpSliders.rotZ.value = t.rot_z ?? 0;
  tpSliders.posX.value = t.pos_x ?? 0;
  tpSliders.posY.value = t.pos_y ?? 0;
  tpSliders.posZ.value = t.pos_z ?? 0;
  tpValues.rotX.textContent = `${t.rot_x ?? 0}°`;
  tpValues.rotY.textContent = `${t.rot_y ?? 0}°`;
  tpValues.rotZ.textContent = `${t.rot_z ?? 0}°`;
  tpValues.posX.textContent = (t.pos_x ?? 0).toFixed(2);
  tpValues.posY.textContent = (t.pos_y ?? 0).toFixed(2);
  tpValues.posZ.textContent = (t.pos_z ?? 0).toFixed(2);
  setRotation(t.rot_x ?? 0, t.rot_y ?? 0, t.rot_z ?? 0);
  setPositionOffset(t.pos_x ?? 0, t.pos_y ?? 0, t.pos_z ?? 0);
}

for (const slider of Object.values(tpSliders)) {
  slider.addEventListener("input", syncTransformFromSliders);
}

function resetSliders() {
  for (const slider of Object.values(tpSliders)) {
    slider.value = 0;
  }
  tpValues.rotX.textContent = "0°";
  tpValues.rotY.textContent = "0°";
  tpValues.rotZ.textContent = "0°";
  tpValues.posX.textContent = "0.00";
  tpValues.posY.textContent = "0.00";
  tpValues.posZ.textContent = "0.00";
  resetTransform();
  debouncedSaveTransform();
}

document.getElementById("tp-reset").onclick = resetSliders;

// ── Info panel ────────────────────────────────────────────────────────
$btnInfo.onclick = () => $infoPanel.classList.toggle("visible");
$btnCloseInfo.onclick = () => $infoPanel.classList.remove("visible");

// ── Sidebar toggle ────────────────────────────────────────────────────
const $sidebar           = document.getElementById("sidebar");
const $btnSidebarToggle  = document.getElementById("btn-sidebar-toggle");
$btnSidebarToggle.onclick = () => {
  const collapsed = $sidebar.classList.toggle("collapsed");
  $btnSidebarToggle.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
};

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
    if ($cropConfirmBar.classList.contains("visible")) _exitDrawMode();
  }
});

// Confirm upload on Enter in name input
$nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("modal-upload-confirm").click();
});

// ── Init ──────────────────────────────────────────────────────────────
initViewports();
refreshList();
