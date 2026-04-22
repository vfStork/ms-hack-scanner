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

          const box = new THREE.Box3().setFromObject(this.currentModel);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3()).length();
          const scale = 1.2 / size;
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
