import { initViewports, showSingle, showSideBySide } from "./viewer.js";

// ── State ────────────────────────────────────────────────────────────
let twins = [];
let activeTwinId = null;
let activeVersion = null;

// ── DOM refs ─────────────────────────────────────────────────────────
const $list = document.getElementById("twin-list");
const $status = document.getElementById("status");
const $loading = document.getElementById("loading");
const $fileInput = document.getElementById("file-input");
const $versionSelect = document.getElementById("version-select");
const $variantSelect = document.getElementById("variant-select");
const $btnUpload = document.getElementById("btn-upload");
const $btnClean = document.getElementById("btn-clean");
const $btnEnrich = document.getElementById("btn-enrich");
const $btnCompare = document.getElementById("btn-compare");
const $btnInfo = document.getElementById("btn-info");
const $infoPanel = document.getElementById("info-panel");
const $metaContent = document.getElementById("metadata-content");
const $changelog = document.getElementById("changelog-section");

// ── Helpers ──────────────────────────────────────────────────────────
function status(msg) {
  $status.textContent = msg;
}
function loading(on) {
  $loading.classList.toggle("active", on);
}

async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body}`);
  }
  return res.json();
}

// ── Twin list ────────────────────────────────────────────────────────
async function refreshList() {
  twins = await api("/api/twins");
  renderList();
}

function renderList() {
  $list.innerHTML = "";
  for (const t of twins) {
    const el = document.createElement("div");
    el.className = "twin-item" + (t.id === activeTwinId ? " active" : "");
    el.innerHTML = `
      <div class="twin-name">${esc(t.name)}</div>
      <div class="twin-meta">${t.versions.length} version(s) · ${t.id.slice(0, 8)}</div>
    `;
    el.onclick = () => selectTwin(t.id);
    $list.appendChild(el);
  }
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// ── Select twin ──────────────────────────────────────────────────────
async function selectTwin(id) {
  activeTwinId = id;
  const twin = await api(`/api/twins/${id}`);
  renderList();
  populateVersions(twin);
  populateInfo(twin);

  const latest = twin.versions[twin.versions.length - 1];
  activeVersion = latest.version;
  $versionSelect.value = latest.version;
  await loadModel(twin, latest.version, $variantSelect.value);

  $btnClean.disabled = false;
  $btnEnrich.disabled = false;
  $btnCompare.disabled = twin.versions.length < 2;
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

function populateInfo(twin) {
  // Metadata
  if (Object.keys(twin.metadata).length > 0) {
    $metaContent.innerHTML = Object.entries(twin.metadata)
      .map(
        ([k, v]) => `<div><strong>${esc(k)}:</strong> ${esc(String(v))}</div>`,
      )
      .join("");
  } else {
    $metaContent.textContent = "Not enriched yet.";
  }

  // Changelog
  $changelog.innerHTML = "";
  if (twin.changelog.length === 0) {
    $changelog.innerHTML =
      '<div class="info-section"><div class="value">No comparisons yet.</div></div>';
  } else {
    for (const c of twin.changelog) {
      const el = document.createElement("div");
      el.className = "changelog-entry";
      el.innerHTML = `
        <div class="ts">v${c.version_a} → v${c.version_b} · ${new Date(c.timestamp).toLocaleString()}</div>
        <div>${esc(c.description)}</div>
      `;
      $changelog.appendChild(el);
    }
  }
}

// ── Load model ───────────────────────────────────────────────────────
async function loadModel(twin, version, variant) {
  const v = twin.versions.find((v) => v.version === version);
  if (!v) return;
  if (variant === "clean" && !v.is_cleaned) {
    status("Cleaned version not available — showing raw");
    variant = "raw";
  }
  const url = `/api/twins/${twin.id}/versions/${version}/model?variant=${variant}`;
  status(`Loading v${version} (${variant})…`);
  await showSingle(url);
  status(`Showing v${version} (${variant})`);
}

// ── Upload ───────────────────────────────────────────────────────────
let uploadMode = "new"; // "new" or "rescan"

$btnUpload.onclick = () => {
  uploadMode = "new";
  $fileInput.click();
};

$fileInput.onchange = async () => {
  const file = $fileInput.files[0];
  if (!file) return;

  loading(true);
  const form = new FormData();
  form.append("file", file);

  try {
    if (uploadMode === "rescan" && activeTwinId) {
      status("Uploading re-scan…");
      await api(`/api/twins/${activeTwinId}/rescan`, {
        method: "POST",
        body: form,
      });
    } else {
      form.append("name", file.name.replace(/\.[^.]+$/, ""));
      status("Uploading scan…");
      const twin = await api("/api/upload", { method: "POST", body: form });
      activeTwinId = twin.id;
    }
    await refreshList();
    await selectTwin(activeTwinId);
    status("Upload complete");
  } catch (e) {
    status("Upload failed: " + e.message);
  } finally {
    loading(false);
    $fileInput.value = "";
  }
};

// ── Clean ────────────────────────────────────────────────────────────
$btnClean.onclick = async () => {
  if (!activeTwinId || !activeVersion) return;
  loading(true);
  status("Cleaning mesh…");
  try {
    await api(`/api/twins/${activeTwinId}/versions/${activeVersion}/clean`, {
      method: "POST",
    });
    await selectTwin(activeTwinId);
    $variantSelect.value = "clean";
    const twin = twins.find((t) => t.id === activeTwinId);
    if (twin)
      await loadModel(
        await api(`/api/twins/${activeTwinId}`),
        activeVersion,
        "clean",
      );
    status("Cleaning complete");
  } catch (e) {
    status("Clean failed: " + e.message);
  } finally {
    loading(false);
  }
};

// ── Enrich ───────────────────────────────────────────────────────────
$btnEnrich.onclick = async () => {
  if (!activeTwinId) return;
  loading(true);
  status("Running AI enrichment…");
  try {
    await api(`/api/twins/${activeTwinId}/enrich`, { method: "POST" });
    await selectTwin(activeTwinId);
    $infoPanel.classList.add("visible");
    status("Enrichment complete");
  } catch (e) {
    status("Enrich failed: " + e.message);
  } finally {
    loading(false);
  }
};

// ── Compare ──────────────────────────────────────────────────────────
$btnCompare.onclick = async () => {
  if (!activeTwinId) return;
  const twin = await api(`/api/twins/${activeTwinId}`);
  if (twin.versions.length < 2) {
    status("Need at least 2 versions to compare");
    return;
  }

  // Compare last two versions
  const va = twin.versions[twin.versions.length - 2].version;
  const vb = twin.versions[twin.versions.length - 1].version;
  const useCleaned = $variantSelect.value === "clean";

  loading(true);
  status(`Comparing v${va} ↔ v${vb}…`);
  try {
    const result = await api("/api/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        twin_id: activeTwinId,
        version_a: va,
        version_b: vb,
        use_cleaned: useCleaned,
      }),
    });

    // Side-by-side: version A on left, heatmap on right
    const urlA = `/api/twins/${activeTwinId}/versions/${va}/model?variant=${useCleaned ? "clean" : "raw"}`;
    await showSideBySide(urlA, result.heatmap_url);

    // Show info panel with description
    $infoPanel.classList.add("visible");
    await selectTwin(activeTwinId);
    status(`Comparison done — mean distance: ${result.diff.mean_distance}`);
  } catch (e) {
    status("Compare failed: " + e.message);
  } finally {
    loading(false);
  }
};

// ── Version / variant selectors ──────────────────────────────────────
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

// ── Info panel toggle ────────────────────────────────────────────────
$btnInfo.onclick = () => $infoPanel.classList.toggle("visible");

// ── Re-scan (context menu on twin item — simplified: hold shift + click upload) ──
document.addEventListener("keydown", (e) => {
  if (e.key === "Shift") $btnUpload.textContent = "Re-scan";
});
document.addEventListener("keyup", (e) => {
  if (e.key === "Shift") $btnUpload.textContent = "Upload Scan";
});
$btnUpload.addEventListener(
  "click",
  (e) => {
    if (e.shiftKey && activeTwinId) {
      uploadMode = "rescan";
      $fileInput.click();
      e.stopImmediatePropagation();
    }
  },
  true,
);

// ── Init ─────────────────────────────────────────────────────────────
initViewports();
refreshList();
