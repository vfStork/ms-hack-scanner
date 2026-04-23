import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

class Viewport {
  constructor(canvas) {
    this.canvas = canvas;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d0f14);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.001, 1000);
    this.camera.position.set(0, 0.5, 1.5);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.localClippingEnabled = true;

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 0.05;
    this.controls.maxDistance = 100;

    // Lighting rig: ambient + hemisphere + key + rim
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    this.scene.add(new THREE.HemisphereLight(0x8ab4e8, 0x3d2b1f, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(3, 5, 3);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x4a7fc1, 0.35);
    rim.position.set(-3, 1, -3);
    this.scene.add(rim);

    const grid = new THREE.GridHelper(4, 40, 0x252836, 0x1a1d27);
    this.scene.add(grid);

    this.currentModel = null;
    this._wireframe = false;
    // Original-space model info (set on each loadGLB, used for clipping conversion)
    this._origCenter = null;
    this._origScale = 1;
    this._origBox = null;
    this._animate();
    this.resize();
  }

  setWireframe(enabled) {
    this._wireframe = enabled;
    if (!this.currentModel) return;
    this.currentModel.traverse((obj) => {
      if (obj.isMesh) obj.material.wireframe = enabled;
    });
  }

  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  loadGLB(url) {
    return new Promise((resolve, reject) => {
      new GLTFLoader().load(
        url,
        (gltf) => {
          if (this.currentModel) this.scene.remove(this.currentModel);
          this.currentModel = gltf.scene;

          // The GLTF spec default PBR material has metallicFactor=1 which
          // renders black under standard lighting without an environment map.
          // Force diffuse-friendly values on every mesh after loading so
          // vertex-colored scan models always show their actual colors.
          this.currentModel.traverse((obj) => {
            if (!obj.isMesh) return;
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            mats.forEach((mat) => {
              mat.metalness = 0;
              mat.roughness = 0.8;
              mat.needsUpdate = true;
            });
          });

          const box = new THREE.Box3().setFromObject(this.currentModel);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3()).length();
          const scale = 1.2 / size;

          // Save original-space info before applying transform
          this._origCenter = center.clone();
          this._origScale = scale;
          this._origBox = box.clone();

          this.currentModel.scale.setScalar(scale);
          this.currentModel.position.sub(center.multiplyScalar(scale));

          if (this._wireframe) {
            this.currentModel.traverse((obj) => {
              if (obj.isMesh) obj.material.wireframe = true;
            });
          }

          this.scene.add(this.currentModel);
          this.controls.reset();
          resolve();
        },
        undefined,
        reject,
      );
    });
  }

  clear() {
    if (this.currentModel) {
      this.scene.remove(this.currentModel);
      this.currentModel = null;
    }
  }

  // ── Model info (original GLB coordinate space) ───────────────────────
  getModelInfo() {
    if (!this._origBox) return null;
    return { box: this._origBox, scale: this._origScale, center: this._origCenter };
  }

  // ── Clipping planes (input coords are in original GLB space) ─────────
  // World position formula: p_world = (p_orig - origCenter) * origScale

  setClippingPlane(pointOrig, normalOrig) {
    if (!this._origCenter) return;
    const n = new THREE.Vector3(...normalOrig).normalize();
    const pWorld = new THREE.Vector3(...pointOrig)
      .sub(this._origCenter)
      .multiplyScalar(this._origScale);
    this.renderer.clippingPlanes = [new THREE.Plane(n, -n.dot(pWorld))];
    this._markMaterialsUpdate();
  }

  setClippingBBox(minOrig, maxOrig) {
    if (!this._origCenter) return;
    const { x: cx, y: cy, z: cz } = this._origCenter;
    const s = this._origScale;
    this.renderer.clippingPlanes = [
      new THREE.Plane(new THREE.Vector3( 1,  0,  0), -((minOrig[0] - cx) * s)),
      new THREE.Plane(new THREE.Vector3(-1,  0,  0),   (maxOrig[0] - cx) * s),
      new THREE.Plane(new THREE.Vector3( 0,  1,  0), -((minOrig[1] - cy) * s)),
      new THREE.Plane(new THREE.Vector3( 0, -1,  0),   (maxOrig[1] - cy) * s),
      new THREE.Plane(new THREE.Vector3( 0,  0,  1), -((minOrig[2] - cz) * s)),
      new THREE.Plane(new THREE.Vector3( 0,  0, -1),   (maxOrig[2] - cz) * s),
    ];
    this._markMaterialsUpdate();
  }

  clearClipping() {
    this.renderer.clippingPlanes = [];
    this._markMaterialsUpdate();
  }

  // Force shader recompile so clipping changes take effect immediately
  _markMaterialsUpdate() {
    if (!this.currentModel) return;
    this.currentModel.traverse((obj) => {
      if (obj.isMesh) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => { m.needsUpdate = true; });
      }
    });
  }

  // ── Draw-to-cut: convert a screen-space line to an original-space plane ──
  // x1,y1,x2,y2 are pixel coords relative to the canvas element.
  screenLineToCropPlane(x1, y1, x2, y2) {
    if (!this._origCenter) return null;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;

    const toNDC = (px, py, z) =>
      new THREE.Vector3((px / w) * 2 - 1, -(py / h) * 2 + 1, z);

    // Project orbit target to get its clip-space depth, so all points
    // are unprojected at the same depth as the model center.
    const targetNDC = this.controls.target.clone().project(this.camera);
    const depth = targetNDC.z;

    const wA = toNDC(x1, y1, depth).unproject(this.camera);
    const wB = toNDC(x2, y2, depth).unproject(this.camera);

    const lineDir = new THREE.Vector3().subVectors(wB, wA).normalize();
    const camFwd  = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const normalWorld = new THREE.Vector3().crossVectors(lineDir, camFwd).normalize();

    // Plane point = midpoint of the drawn line unprojected at model-center depth
    // — this places the cut where the user actually drew it.
    const ptWorld = toNDC((x1 + x2) / 2, (y1 + y2) / 2, depth).unproject(this.camera);

    const s = this._origScale;
    const c = this._origCenter;
    const pointOrig  = [ptWorld.x / s + c.x, ptWorld.y / s + c.y, ptWorld.z / s + c.z];
    const normalOrig = [normalWorld.x, normalWorld.y, normalWorld.z];

    return { pointOrig, normalOrig };
  }

  _animate() {
    requestAnimationFrame(() => this._animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

// ── Singleton viewports ──────────────────────────────────────────────
let vpA = null;
let vpB = null;
let _syncA = null;
let _syncB = null;

export function initViewports() {
  vpA = new Viewport(document.getElementById("viewport"));
  vpB = new Viewport(document.getElementById("viewport-b"));
  window.addEventListener("resize", () => {
    vpA.resize();
    vpB.resize();
  });
}

export function getViewportA() { return vpA; }
export function getViewportB() { return vpB; }

export function setWireframe(enabled) {
  vpA.setWireframe(enabled);
  vpB.setWireframe(enabled);
}

function _removeSyncListeners() {
  if (_syncA) { vpA.controls.removeEventListener("change", _syncA); _syncA = null; }
  if (_syncB) { vpB.controls.removeEventListener("change", _syncB); _syncB = null; }
}

function _setupSync() {
  _removeSyncListeners();
  let busy = false;
  _syncA = () => {
    if (busy) return;
    busy = true;
    vpB.camera.position.copy(vpA.camera.position);
    vpB.camera.quaternion.copy(vpA.camera.quaternion);
    vpB.controls.target.copy(vpA.controls.target);
    vpB.controls.update();
    busy = false;
  };
  _syncB = () => {
    if (busy) return;
    busy = true;
    vpA.camera.position.copy(vpB.camera.position);
    vpA.camera.quaternion.copy(vpB.camera.quaternion);
    vpA.controls.target.copy(vpB.controls.target);
    vpA.controls.update();
    busy = false;
  };
  vpA.controls.addEventListener("change", _syncA);
  vpB.controls.addEventListener("change", _syncB);
}

export async function showSingle(glbUrl) {
  _removeSyncListeners();
  document.getElementById("vp-b-wrap").style.display = "none";
  vpA.resize();
  await vpA.loadGLB(glbUrl);
}

export async function showSideBySide(urlA, urlB) {
  document.getElementById("vp-b-wrap").style.display = "flex";
  // Allow layout to settle before resize
  await new Promise((r) => setTimeout(r, 50));
  vpA.resize();
  vpB.resize();
  await Promise.all([vpA.loadGLB(urlA), vpB.loadGLB(urlB)]);
  _setupSync();
}
