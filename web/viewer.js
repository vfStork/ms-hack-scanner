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
    this.pivotGroup = null;
    this._wireframe = false;
    this._animate();
    this.resize();
  }

  setWireframe(enabled) {
    this._wireframe = enabled;
    if (!this.pivotGroup) return;
    this.pivotGroup.traverse((obj) => {
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
          if (this.pivotGroup) this.scene.remove(this.pivotGroup);
          this.currentModel = gltf.scene;

          // Scale to fit viewport
          const box = new THREE.Box3().setFromObject(this.currentModel);
          const size = box.getSize(new THREE.Vector3()).length();
          const scale = 1.2 / size;
          this.currentModel.scale.setScalar(scale);

          // Recompute bounds after scaling
          const scaledBox = new THREE.Box3().setFromObject(this.currentModel);
          const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
          const scaledMin = scaledBox.min;

          // Position model so its bottom sits on Y=0 and it's centered on X/Z
          this.currentModel.position.set(
            -scaledCenter.x,
            -scaledMin.y,
            -scaledCenter.z,
          );

          // Create pivot at origin (grid contact point) for rotation
          this.pivotGroup = new THREE.Group();
          this.pivotGroup.add(this.currentModel);
          this.scene.add(this.pivotGroup);

          if (this._wireframe) {
            this.currentModel.traverse((obj) => {
              if (obj.isMesh) obj.material.wireframe = true;
            });
          }

          this.controls.reset();
          resolve();
        },
        undefined,
        reject,
      );
    });
  }

  clear() {
    if (this.pivotGroup) {
      this.scene.remove(this.pivotGroup);
      this.pivotGroup = null;
      this.currentModel = null;
    }
  }

  rotateModel(axis, angleDeg) {
    if (!this.pivotGroup) return;
    const rad = (angleDeg * Math.PI) / 180;
    switch (axis) {
      case "x": this.pivotGroup.rotateX(rad); break;
      case "y": this.pivotGroup.rotateY(rad); break;
      case "z": this.pivotGroup.rotateZ(rad); break;
    }
  }

  resetRotation() {
    if (!this.pivotGroup) return;
    this.pivotGroup.rotation.set(0, 0, 0);
  }

  setRotation(xDeg, yDeg, zDeg) {
    if (!this.pivotGroup) return;
    this.pivotGroup.rotation.set(
      (xDeg * Math.PI) / 180,
      (yDeg * Math.PI) / 180,
      (zDeg * Math.PI) / 180,
    );
  }

  setPositionOffset(x, y, z) {
    if (!this.pivotGroup) return;
    this.pivotGroup.position.set(x, y, z);
  }

  resetTransform() {
    if (!this.pivotGroup) return;
    this.pivotGroup.rotation.set(0, 0, 0);
    this.pivotGroup.position.set(0, 0, 0);
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

export function rotateModel(axis, angleDeg) {
  vpA.rotateModel(axis, angleDeg);
  vpB.rotateModel(axis, angleDeg);
}

export function resetRotation() {
  vpA.resetRotation();
  vpB.resetRotation();
}

export function setRotation(xDeg, yDeg, zDeg) {
  vpA.setRotation(xDeg, yDeg, zDeg);
  vpB.setRotation(xDeg, yDeg, zDeg);
}

export function setPositionOffset(x, y, z) {
  vpA.setPositionOffset(x, y, z);
  vpB.setPositionOffset(x, y, z);
}

export function resetTransform() {
  vpA.resetTransform();
  vpB.resetTransform();
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
