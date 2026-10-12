// PIT WALL 3D core: stage, GLB loading, auto-orientation, part splitting, exploded view and livery modes.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export { THREE };

// GitHub Pages serves the binary .glb files; hosts that only serve text get self-contained .json glTF copies.
export function modelUrl(id) {
  const ext = window.PW_MODEL_FORMAT === "json" ? "json" : "glb";
  return new URL(`../models/${id}.${ext}`, import.meta.url).href;
}

const loader = new GLTFLoader();
const cache = new Map();

/* ---------------- stage ---------------- */

export function createStage(container, opts = {}) {
  const dark = opts.theme === "dark";
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: !!opts.transparent, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.maxDpr || 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = opts.exposure ?? (dark ? 1.0 : 1.05);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = "stage-canvas";
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = dark ? 0.55 : 1.0;
  pm.dispose();
  if (opts.background) scene.background = new THREE.Color(opts.background);
  if (opts.fog) scene.fog = new THREE.Fog(opts.fog[0], opts.fog[1], opts.fog[2]);

  const camera = new THREE.PerspectiveCamera(opts.fov || 30, 1, 0.05, 600);
  camera.position.set(6, 2.4, 6);

  scene.add(new THREE.HemisphereLight(dark ? 0x8fa6c8 : 0xffffff, dark ? 0x0a0c12 : 0xc9d4e2, dark ? 0.6 : 1.1));
  const key = new THREE.DirectionalLight(0xffffff, dark ? 2.2 : 2.4);
  key.position.set(5, 9, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 30 });
  key.shadow.bias = -0.0004;
  key.shadow.radius = 5;
  scene.add(key);
  const rims = [];
  if (dark) {
    for (const [x, y, z, c, i] of [[-7, 3, -5, 0x4fd2ff, 0.9], [7, 2.5, -4, 0xff3b5c, 0.6], [0, 6, 8, 0xffffff, 0.8]]) {
      const l = new THREE.DirectionalLight(c, i);
      l.position.set(x, y, z);
      scene.add(l);
      rims.push(l);
    }
  }

  let ground = null;
  if (opts.ground !== false) {
    if (dark) {
      ground = new THREE.Mesh(new THREE.CircleGeometry(40, 64), new THREE.MeshStandardMaterial({ color: 0x080a10, roughness: 0.55, metalness: 0.15 }));
      const grid = new THREE.GridHelper(40, 80, 0x1d2840, 0x121a2b);
      grid.position.y = 0.002;
      grid.material.transparent = true;
      grid.material.opacity = 0.55;
      scene.add(grid);
    } else {
      ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.ShadowMaterial({ opacity: 0.18 }));
    }
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
  }

  const tickers = new Set();
  let visible = true;
  let alive = true;
  const clock = new THREE.Clock();
  const resize = () => {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();
  const io = new IntersectionObserver((e) => { visible = e[0].isIntersecting; }, { rootMargin: "200px" });
  io.observe(container);
  renderer.setAnimationLoop(() => {
    const raw = clock.getDelta();
    if (!alive || !visible) return;
    // tweens use real elapsed time (raw) so they last the same on slow devices; physics-ish motion uses the capped dt
    const dt = Math.min(raw, 0.05);
    for (const f of tickers) f(dt, clock.elapsedTime, Math.min(raw, 0.25));
    renderer.render(scene, camera);
  });

  return {
    THREE, renderer, scene, camera, key, rims, ground,
    onTick(f) { tickers.add(f); return () => tickers.delete(f); },
    dispose() { alive = false; renderer.setAnimationLoop(null); ro.disconnect(); io.disconnect(); renderer.dispose(); },
  };
}

/* ---------------- loading & normalisation ---------------- */

const WHEEL_RE = /tyre|tire|tread|sidewall|side_?wall|tyre_side|goodyear|pirelli|bridgestone|michelin|rubber|rim|spoke|hub|wheel(?!.*steer)|disk|disc(?!s_\d)|brake|caliper|calliper|roue/i;
const STEER_RE = /steer|swhl|sw_|stw_/i;

export async function loadCar(url, onProgress, opts = {}) {
  if (!cache.has(url)) {
    cache.set(url, new Promise((res, rej) => loader.load(url, (g) => res(g.scene), (e) => onProgress?.(e.total ? e.loaded / e.total : 0), rej)));
  }
  const src = await cache.get(url);
  const model = src.clone(true);
  return normalise(model, opts.length);
}

// Rotates the model so the nose points to +X, sits on y = 0, and centres it between the axles.
function normalise(model, realLength) {
  const root = new THREE.Group();
  root.add(model);
  model.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(model, true);
  let size = box.getSize(new THREE.Vector3());
  // Length runs along the longer horizontal axis.
  if (size.z > size.x) model.rotation.y = Math.PI / 2;
  model.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(model, true);
  size = box.getSize(new THREE.Vector3());
  // Scale to the real car's length (models come in assorted units).
  const scale = realLength ? realLength / size.x : size.x > 20 || size.x < 2 ? 5.4 / size.x : 1;
  model.scale.multiplyScalar(scale);
  model.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(model, true);

  // The rear wing makes the tail the taller end; flip so the nose faces +X.
  const tall = { front: 0, rear: 0 };
  const len = box.max.x - box.min.x;
  const v = new THREE.Vector3();
  model.traverse((o) => {
    if (!o.isMesh) return;
    const p = o.geometry.attributes.position;
    const step = Math.max(1, Math.floor(p.count / 3000));
    for (let i = 0; i < p.count; i += step) {
      v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
      const t = (v.x - box.min.x) / len;
      const h = v.y - box.min.y;
      if (t > 0.88) tall.front = Math.max(tall.front, h);
      if (t < 0.12) tall.rear = Math.max(tall.rear, h);
    }
  });
  if (tall.front > tall.rear) model.rotation.y += Math.PI;
  model.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(model, true);
  model.position.y -= box.min.y;
  model.position.x -= (box.min.x + box.max.x) / 2;
  model.position.z -= (box.min.z + box.max.z) / 2;
  model.updateMatrixWorld(true);

  const meshes = [];
  model.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      meshes.push(o);
    }
  });
  const info = measure(meshes);
  model.position.x -= info.mid;
  model.updateMatrixWorld(true);
  for (const k of ["xf", "xr", "xHoop"]) info[k] -= info.mid;
  info.wheels.forEach((w) => { w.x -= info.mid; });
  info.mid = 0;
  root.userData = { model, meshes, info, parts: null };
  return root;
}

// Finds axles, wheels and the roll hoop from the geometry itself.
function measure(meshes) {
  const v = new THREE.Vector3();
  const box = new THREE.Box3();
  meshes.forEach((m) => box.expandByObject(m, true));
  const L = box.max.x - box.min.x;
  // wheel candidates: tyre-like materials, else everything low and wide
  const wheelPts = [];
  for (const m of meshes) {
    const names = (Array.isArray(m.material) ? m.material : [m.material]).map((x) => x.name).join(" ") + " " + m.name;
    if (!WHEEL_RE.test(names) || STEER_RE.test(names)) continue;
    const p = m.geometry.attributes.position;
    const step = Math.max(1, Math.floor(p.count / 4000));
    for (let i = 0; i < p.count; i += step) wheelPts.push(v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld).clone());
  }
  const W = Math.max(Math.abs(box.min.z), box.max.z);
  let pts = wheelPts.filter((q) => Math.abs(q.z) > W * 0.55 && q.y < 0.8);
  const named = meshes.filter((m) => WHEEL_RE.test(((Array.isArray(m.material) ? m.material : [m.material]).map((x) => x.name).join(" ")) + " " + m.name)).length;
  if (pts.length < 200 || named > meshes.length * 0.7) {
    pts = [];
    for (const m of meshes) {
      const p = m.geometry.attributes.position;
      const step = Math.max(1, Math.floor(p.count / 4000));
      for (let i = 0; i < p.count; i += step) {
        const q = v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
        if (Math.abs(q.z) > W * 0.8 && q.y < 0.8 && q.y > 0.03) pts.push(q.clone());
      }
    }
  }
  const quad = { FL: [], FR: [], RL: [], RR: [] };
  const cx = (box.min.x + box.max.x) / 2;
  for (const q of pts) quad[(q.x > cx ? "F" : "R") + (q.z > 0 ? "L" : "R")].push(q);
  const wheels = [];
  for (const k of ["FL", "FR", "RL", "RR"]) {
    const a = quad[k];
    if (!a.length) continue;
    const b = new THREE.Box3().setFromPoints(a);
    const r = Math.min((b.max.y - b.min.y) / 2, 0.42);
    wheels.push({ key: k, x: (b.min.x + b.max.x) / 2, z: (b.min.z + b.max.z) / 2, r: Math.max(0.28, r), w: Math.min(0.48, b.max.z - b.min.z), inner: Math.min(Math.abs(b.min.z), Math.abs(b.max.z)) });
  }
  const avg = (ks, f) => { const s = wheels.filter((w) => ks.includes(w.key)); return s.length ? s.reduce((t, w) => t + f(w), 0) / s.length : null; };
  const xf = avg(["FL", "FR"], (w) => w.x) ?? box.max.x - L * 0.17;
  const xr = avg(["RL", "RR"], (w) => w.x) ?? box.min.x + L * 0.17;
  const r = avg(["FL", "FR", "RL", "RR"], (w) => w.r) ?? 0.33;
  const inner = avg(["FL", "FR", "RL", "RR"], (w) => w.inner) ?? 0.55;
  // roll hoop: highest point between the axles, away from the wings
  let xHoop = (xf + xr) / 2, yHoop = 0;
  for (const m of meshes) {
    const p = m.geometry.attributes.position;
    const step = Math.max(1, Math.floor(p.count / 6000));
    for (let i = 0; i < p.count; i += step) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      if (v.x < xr + 0.5 || v.x > xf - 0.6 || Math.abs(v.z) > 0.2) continue;
      if (v.y > yHoop) { yHoop = v.y; xHoop = v.x; }
    }
  }
  return { L, W, xf, xr, r, inner, xHoop, yHoop, wheels, mid: (xf + xr) / 2, height: box.max.y };
}

/* ---------------- parts ---------------- */

export const PART_ORDER = ["frontWing", "nose", "chassis", "cockpit", "sidepods", "cover", "powerUnit", "floor", "suspension", "wheels", "gearbox", "rearWing"];

const EXPLODE = {
  frontWing: [1.55, -0.05, 0], nose: [0.95, 0.18, 0], chassis: [0, 0, 0], cockpit: [0.15, 1.25, 0], cover: [-0.25, 1.15, 0],
  floor: [0, -0.75, 0], gearbox: [-0.95, 0.15, 0], rearWing: [-1.35, 0.85, 0], powerUnit: [-0.15, 0.55, 0],
};

function classify(x, y, z, I) {
  const az = Math.abs(z);
  for (const w of I.wheels) {
    const dx = x - w.x, dy = y - w.r;
    if (Math.abs(z - w.z) < w.w / 2 + 0.07 && dx * dx + dy * dy < (w.r + 0.035) ** 2) return "wheel" + w.key;
  }
  const front = x > I.xf + I.r * 0.75;
  if (front && y < 0.42) return "frontWing";
  if (x > I.xf - 0.3) return az > 0.3 && y < 0.5 ? "frontWing" : "nose";
  if (az > 0.26 && az < I.inner + 0.04 && y > 0.1 && y < 0.78 && (Math.abs(x - I.xf) < 0.55 || Math.abs(x - I.xr) < 0.5)) return z > 0 ? "suspensionL" : "suspensionR";
  if (x < I.xr + 0.12 && y > 0.6) return "rearWing";
  if (x < I.xr - 0.28 && y > 0.3 && az > 0.13) return "rearWing";
  if (y < 0.085 && az < I.inner) return "floor";
  if (x < I.xr + 0.45 && az < 0.3) return y < 0.13 && az > 0.12 ? "floor" : "gearbox";
  if (x > I.xHoop + 0.1 && x < I.xHoop + 1.35 && y > I.yHoop * 0.66 && az < 0.6) return "cockpit";
  if (x < I.xHoop + 0.12 && x > I.xr + 0.3 && az < 0.42 && y > 0.4) return "cover";
  if (az > 0.25 && x > I.xr + 0.3 && x < I.xf - 0.45 && y < 0.78) return y < 0.07 ? "floor" : z > 0 ? "sidepodsL" : "sidepodsR";
  if (x < I.xr + 0.3 && y < 0.2) return "floor";
  return "chassis";
}

// Splits every mesh's triangles into named parts (geometry attributes are shared, only indices are new).
export function splitParts(car) {
  const U = car.userData;
  if (U.parts) return U.parts;
  const I = U.info;
  const groups = {};
  const group = (k) => {
    if (!groups[k]) {
      const g = new THREE.Group();
      g.name = k;
      const ex = EXPLODE[k] ? new THREE.Vector3(...EXPLODE[k]) : new THREE.Vector3();
      if (k.startsWith("wheel")) {
        const w = I.wheels.find((q) => "wheel" + q.key === k);
        ex.set(w && w.x > 0 ? 0.35 : -0.35, 0, w && w.z > 0 ? 1.05 : -1.05);
      }
      if (k === "sidepodsL") ex.set(0, 0.1, 0.95);
      if (k === "sidepodsR") ex.set(0, 0.1, -0.95);
      if (k === "suspensionL") ex.set(0, 0, 0.5);
      if (k === "suspensionR") ex.set(0, 0, -0.5);
      g.userData = { key: k, part: partOf(k), explode: ex };
      groups[k] = g;
      car.add(g);
    }
    return groups[k];
  };
  const v = new THREE.Vector3();
  const inv = new THREE.Matrix4().copy(car.matrixWorld).invert();
  car.updateMatrixWorld(true);
  for (const m of U.meshes) {
    const geo = m.geometry;
    const pos = geo.attributes.position;
    const idx = geo.index ? geo.index.array : null;
    const triCount = idx ? idx.length / 3 : pos.count / 3;
    const rel = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
    const buckets = {};
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx[t * 3] : t * 3, i1 = idx ? idx[t * 3 + 1] : t * 3 + 1, i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
      a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
      v.copy(a).add(b).add(c).multiplyScalar(1 / 3).applyMatrix4(rel);
      const k = classify(v.x, v.y, v.z, I);
      (buckets[k] || (buckets[k] = [])).push(i0, i1, i2);
    }
    for (const k in buckets) {
      const g = new THREE.BufferGeometry();
      for (const name in geo.attributes) g.setAttribute(name, geo.attributes[name]);
      g.setIndex(buckets[k]);
      g.computeBoundingSphere();
      const mats = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
      const sub = new THREE.Mesh(g, mats);
      sub.matrixAutoUpdate = false;
      sub.matrix.copy(rel);
      sub.castShadow = sub.receiveShadow = true;
      sub.userData.part = partOf(k);
      group(k).add(sub);
    }
    m.visible = false;
  }
  U.model.visible = false;
  // schematic power unit, shown when exploded
  const pu = group("powerUnit");
  pu.add(powerUnitModel(car.userData.era || 2026, I));
  pu.visible = false;
  for (const k in groups) groups[k].userData.home = groups[k].position.clone();
  U.parts = groups;
  return groups;
}

export function partOf(k) {
  if (k.startsWith("wheel")) return "wheels";
  if (k.startsWith("sidepods")) return "sidepods";
  if (k.startsWith("suspension")) return "suspension";
  return k;
}

export function setExplode(car, t) {
  const parts = car.userData.parts;
  if (!parts) return;
  const e = t * t * (3 - 2 * t);
  for (const k in parts) {
    const g = parts[k];
    g.position.copy(g.userData.home).addScaledVector(g.userData.explode, e);
  }
  if (parts.powerUnit) {
    parts.powerUnit.visible = t > 0.05;
    parts.powerUnit.traverse((o) => { if (o.material) o.material.opacity = Math.min(1, t * 1.4) * (o.userData.baseOpacity ?? 1); });
  }
}

export function highlight(car, part, on) {
  const parts = car.userData.parts;
  if (!parts) return;
  for (const k in parts) {
    const hit = part && parts[k].userData.part === part;
    parts[k].traverse((o) => {
      if (!o.isMesh || o.userData.xray) return;
      for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!mat.emissive) continue;
        mat.emissive.setHex(hit && on ? 0x2a6dff : 0x000000);
        mat.emissiveIntensity = hit && on ? 0.55 : 1;
      }
    });
  }
}

export function partBox(car, part) {
  const box = new THREE.Box3();
  const parts = car.userData.parts;
  for (const k in parts) if (parts[k].userData.part === part) box.expandByObject(parts[k]);
  return box;
}

// Stylised X-ray power unit: V10 / V8 / V6 turbo hybrid with battery and motor-generators.
function powerUnitModel(era, I) {
  const g = new THREE.Group();
  const glow = (c, o = 0.55) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.55, transparent: true, opacity: o, roughness: 0.4, metalness: 0.2, depthWrite: false });
  const metal = glow(0x4fd2ff, 0.32);
  const type = era < 2006 ? "V10" : era < 2014 ? "V8" : "V6T";
  const n = type === "V10" ? 5 : type === "V8" ? 4 : 3;
  const len = n * 0.12 + 0.12;
  const block = new THREE.Mesh(new THREE.BoxGeometry(len, 0.24, 0.3), metal);
  g.add(block);
  for (const s of [-1, 1]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(len * 0.95, 0.08, 0.15), metal);
    head.position.set(0, 0.17, s * 0.15);
    head.rotation.x = -s * 0.6;
    g.add(head);
    for (let i = 0; i < n; i++) {
      const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.032, 0.12, 12), glow(0xd0dcef));
      tr.position.set(-len / 2 + (len / n) * (i + 0.5), 0.27, s * 0.08);
      g.add(tr);
    }
  }
  if (type === "V6T") {
    const turbo = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.04, 12, 24), glow(0xffb547));
    turbo.position.set(-len / 2 - 0.1, 0.05, 0);
    turbo.rotation.y = Math.PI / 2;
    g.add(turbo);
    const mguh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.14, 16), glow(0x48d6ff));
    mguh.rotation.z = Math.PI / 2;
    mguh.position.set(-len / 2 - 0.02, 0.05, 0);
    if (era < 2026) g.add(mguh);
  }
  if (era >= 2009) {
    const bat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.36), glow(0x48d6ff, 0.85));
    bat.position.set(len / 2 + 0.3, -0.1, 0);
    g.add(bat);
    const mguk = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.16, 16), glow(0x48d6ff));
    mguk.position.set(len / 2 - 0.05, -0.04, 0.2);
    mguk.rotation.x = Math.PI / 2;
    g.add(mguk);
  }
  // crisp outline on every block so the X-ray reads as a technical drawing
  const lines = [];
  g.traverse((o) => { if (o.isMesh) lines.push(o); });
  for (const o of lines) {
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 25), new THREE.LineBasicMaterial({ color: 0x9be8ff, transparent: true, opacity: 0.95 }));
    e.position.copy(o.position); e.rotation.copy(o.rotation); e.scale.copy(o.scale);
    g.add(e);
  }
  g.traverse((o) => { if (o.isMesh || o.isLineSegments) { o.userData.xray = true; o.userData.part = "powerUnit"; o.userData.baseOpacity = o.material.opacity; } });
  g.position.set((I.xHoop + I.xr) / 2 + 0.05, 0.32, 0);
  return g;
}

/* ---------------- liveries ---------------- */

// Modes: "original", "carbon" (bare launch car), "tunnel" (white wind-tunnel model), "chrome", or a hex tint
// that repaints saturated paint while keeping carbon, black and white sponsor areas.
export function applyLivery(car, mode) {
  const parts = car.userData.parts;
  const roots = parts ? Object.values(parts) : [car.userData.model];
  for (const r of roots) {
    const isWheel = r.name && r.name.startsWith("wheel");
    r.traverse((o) => {
      if (!o.isMesh || o.userData.xray) return;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      list.forEach((mat) => {
        if (!mat.userData.orig) mat.userData.orig = { color: mat.color.clone(), map: mat.map, metalness: mat.metalness, roughness: mat.roughness };
        const O = mat.userData.orig;
        if (mat.userData.tintOn) mat.userData.tintOn.value = 0;
        mat.color.copy(O.color); mat.map = O.map; mat.metalness = O.metalness; mat.roughness = O.roughness;
        if (isWheel || mode === "original") { mat.needsUpdate = true; return; }
        if (mode === "carbon") { mat.map = null; mat.color.setHex(0x1d2026); mat.metalness = 0.45; mat.roughness = 0.36; }
        else if (mode === "tunnel") { mat.map = null; mat.color.setHex(0xe9ecef); mat.metalness = 0; mat.roughness = 0.75; }
        else if (mode === "chrome") { mat.color.setHex(0xd6dbe2); mat.metalness = 1; mat.roughness = 0.12; }
        else if (/^#/.test(mode)) tint(mat, mode);
        mat.needsUpdate = true;
      });
    });
  }
}

function tint(mat, hex) {
  if (!mat.userData.tint) {
    mat.userData.tint = { value: new THREE.Color() };
    mat.userData.tintOn = { value: 0 };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTint = mat.userData.tint;
      sh.uniforms.uTintOn = mat.userData.tintOn;
      sh.fragmentShader = "uniform vec3 uTint;\nuniform float uTintOn;\n" + sh.fragmentShader.replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        {
          vec3 c = diffuseColor.rgb;
          float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
          float sat = mx - mn;
          float luma = dot(c, vec3(0.299, 0.587, 0.114));
          float w = smoothstep(0.08, 0.28, sat) * uTintOn;
          diffuseColor.rgb = mix(c, uTint * (0.35 + luma * 1.25), w);
        }`
      );
    };
    mat.customProgramCacheKey = () => "tint";
  }
  mat.userData.tint.value.set(hex);
  mat.userData.tintOn.value = 1;
}
