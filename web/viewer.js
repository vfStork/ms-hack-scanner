import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/**
 * Manages a Three.js viewport bound to a <canvas> element.
 */
class Viewport {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x13151c);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
    this.camera.position.set(0, 0.5, 1.5);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(2, 3, 2);
    this.scene.add(dir);

    // Grid
    const grid = new THREE.GridHelper(2, 20, 0x2a2d3a, 0x1a1d27);
    this.scene.add(grid);

    this.currentModel = null;
    this._animate();
    this.resize();
  }

  resize() {
    const parent = this.canvas.parentElement;
    const w = this.canvas.clientWidth || parent.clientWidth;
    const h = this.canvas.clientHeight || parent.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  loadGLB(url) {
    return new Promise((resolve, reject) => {
      const loader = new GLTFLoader();
      loader.load(
        url,
        (gltf) => {
          if (this.currentModel) this.scene.remove(this.currentModel);
          this.currentModel = gltf.scene;

          // Centre and scale
          const box = new THREE.Box3().setFromObject(this.currentModel);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3()).length();
          const scale = 1.0 / size;
          this.currentModel.scale.setScalar(scale);
          this.currentModel.position.sub(center.multiplyScalar(scale));

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

export function initViewports() {
  vpA = new Viewport(document.getElementById("viewport"));
  vpB = new Viewport(document.getElementById("viewport-b"));
  window.addEventListener("resize", () => {
    vpA.resize();
    vpB.resize();
  });
}

export function getViewportA() {
  return vpA;
}
export function getViewportB() {
  return vpB;
}

/**
 * Show a single model in the primary viewport.
 */
export async function showSingle(glbUrl) {
  document.getElementById("viewport-b").style.display = "none";
  vpA.canvas.style.flex = "1";
  vpA.resize();
  await vpA.loadGLB(glbUrl);
}

/**
 * Show two models side by side (e.g. v1 vs v2).
 */
export async function showSideBySide(urlA, urlB) {
  document.getElementById("viewport-b").style.display = "block";
  vpA.canvas.style.flex = "1";
  vpA.resize();
  vpB.resize();
  await Promise.all([vpA.loadGLB(urlA), vpB.loadGLB(urlB)]);
}
