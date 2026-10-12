import { THREE, createStage, loadCar, splitParts, setExplode, highlight, partBox, applyLivery, PART_ORDER } from "./f1-3d.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { ERAS, CARS, PARTS } from "../data/cars.js";

const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const MODEL_BASE = new URL("../models/", import.meta.url).href;

const LIVERIES = [
  { id: "original", label: "Оригинал", sw: "conic-gradient(#e10600 0 25%, #00d2be 0 50%, #ff8000 0 75%, #1e3d8f 0)" },
  { id: "carbon", label: "Голый карбон", sw: "repeating-linear-gradient(45deg, #23262c 0 3px, #32363e 3px 6px)" },
  { id: "tunnel", label: "Аэротруба", sw: "#e9ecef" },
  { id: "chrome", label: "Хром", sw: "linear-gradient(135deg, #f5f7fa, #8e98a6 50%, #e8ecf1)" },
  { id: "#e10600", label: "Красный", dot: true },
  { id: "#ff8000", label: "Папайя", dot: true },
  { id: "#00a19b", label: "Бирюзовый", dot: true },
  { id: "#1e41ff", label: "Синий", dot: true },
  { id: "#ffd400", label: "Жёлтый", dot: true },
  { id: "#0a7a45", label: "Британский зелёный", dot: true },
];

const state = { era: null, car: null, carObj: null, exploded: 0, target: 0, livery: "original", part: null, token: 0 };

/* ---------------- stage ---------------- */
const stageEl = $("#stage");
const stage = createStage(stageEl, { theme: "dark", background: 0x07090f, fog: [0x07090f, 16, 46], fov: 32 });
const { camera, renderer, scene } = stage;
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 3.2;
controls.maxDistance = 17;
controls.maxPolarAngle = Math.PI * 0.49;
controls.target.set(0, 0.55, 0);
controls.autoRotate = !REDUCED;
controls.autoRotateSpeed = 0.6;
controls.enablePan = false;
controls.addEventListener("start", () => { controls.autoRotate = false; fly = null; });

let fly = null; // camera flight {from, to, tFrom, tTo, t, dur}
function flyTo(pos, target, dur = 1.1) {
  if (REDUCED) {
    camera.position.copy(pos);
    controls.target.copy(target);
    return;
  }
  fly = { p0: camera.position.clone(), p1: pos.clone(), t0: controls.target.clone(), t1: target.clone(), t: 0, dur };
}
function homeView(dist = 9.2) {
  return { pos: new THREE.Vector3(dist * 0.62, dist * 0.32, dist * 0.72), target: new THREE.Vector3(0, 0.5, 0) };
}

stage.onTick((dt, now, raw) => {
  if (fly) {
    fly.t = Math.min(1, fly.t + raw / fly.dur);
    const k = fly.t < 0.5 ? 4 * fly.t ** 3 : 1 - (-2 * fly.t + 2) ** 3 / 2;
    camera.position.lerpVectors(fly.p0, fly.p1, k);
    // lift the path slightly so flights arc over the car
    camera.position.y += Math.sin(k * Math.PI) * 0.6;
    controls.target.lerpVectors(fly.t0, fly.t1, k);
    if (fly.t >= 1) fly = null;
  }
  if (state.carObj && Math.abs(state.exploded - state.target) > 1e-3) {
    state.exploded += Math.sign(state.target - state.exploded) * Math.min(Math.abs(state.target - state.exploded), raw / 1.0);
    setExplode(state.carObj, state.exploded);
  }
  controls.update();
});

/* ---------------- UI builders ---------------- */
function renderEras() {
  const nav = $("#eras");
  nav.textContent = "";
  nav.setAttribute("role", "tablist");
  for (const e of ERAS) {
    const b = el("button", "a-era");
    b.type = "button";
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(e.id === state.era));
    b.append(el("b", null, e.years), el("span", null, e.title));
    b.addEventListener("click", () => selectEra(e.id));
    nav.append(b);
  }
}

function renderEraInfo() {
  const e = ERAS.find((x) => x.id === state.era);
  $("#era-title").textContent = e.title;
  $("#era-years").textContent = e.years;
  const ul = $("#era-rules");
  ul.textContent = "";
  for (const r of e.rules) ul.append(el("li", null, r));
  const list = $("#cars");
  list.textContent = "";
  for (const c of CARS.filter((x) => x.era === state.era)) {
    const b = el("button", "a-car");
    b.type = "button";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(c.id === state.car));
    b.style.setProperty("--team", c.color);
    const mid = el("div");
    mid.append(el("b", null, c.name), el("span", null, c.team));
    b.append(el("i"), mid, el("em", null, c.year));
    b.addEventListener("click", () => selectCar(c.id));
    list.append(b);
  }
}

function renderLiveries() {
  const box = $("#liveries");
  box.textContent = "";
  for (const l of LIVERIES) {
    const b = el("button", "a-liv" + (l.dot ? " is-dot" : ""));
    b.type = "button";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(l.id === state.livery));
    b.setAttribute("aria-label", l.label);
    b.title = l.label;
    const i = el("i");
    i.style.setProperty("--sw", l.sw || l.id);
    b.append(i);
    if (!l.dot) b.append(document.createTextNode(l.label));
    b.addEventListener("click", () => {
      state.livery = l.id;
      if (state.carObj) applyLivery(state.carObj, l.id);
      renderLiveries();
    });
    box.append(b);
  }
}

function seasonLine(c) {
  const S = window.F1_SEASON;
  if (!S || !c.teamId) return null;
  const t = S.teams.find((x) => x.id === c.teamId);
  if (!t) return null;
  const pts = Number.isInteger(t.points) ? t.points : t.points.toFixed(1);
  return `${t.pos}-е место в Кубке конструкторов ${S.year}, ${pts} очков, побед: ${t.wins} (после этапа ${S.round})`;
}

function renderCarInfo() {
  const c = CARS.find((x) => x.id === state.car);
  $("#car-name").textContent = c.name;
  $("#car-meta").textContent = `${c.team} · сезон ${c.year}`;
  const specs = $("#specs");
  specs.textContent = "";
  for (const [k, v] of [["Сезон", c.year], ["Силовая установка", c.engine], ["Пилоты", c.drivers]]) {
    const d = el("div");
    d.append(el("dt", null, k), el("dd", null, v));
    specs.append(d);
  }
  const facts = $("#facts");
  facts.textContent = "";
  const live = seasonLine(c);
  for (const f of live ? [live, ...c.facts] : c.facts) facts.append(el("li", null, f));
}

function renderParts() {
  const box = $("#parts");
  box.textContent = "";
  const present = state.carObj ? new Set(Object.values(state.carObj.userData.parts || {}).map((g) => g.userData.part)) : new Set();
  for (const key of PART_ORDER) {
    if (!present.has(key)) continue;
    const b = el("button", "a-chip", PARTS[key].name);
    b.type = "button";
    b.setAttribute("aria-pressed", String(state.part === key));
    b.addEventListener("click", () => selectPart(state.part === key ? null : key, true));
    box.append(b);
  }
}

function renderPartCard() {
  const card = $("#part-card");
  if (!state.part) { card.hidden = true; return; }
  const p = PARTS[state.part];
  card.hidden = false;
  $("#part-name").textContent = p.name;
  $("#part-text").textContent = p.text;
  const note = p.era[state.era];
  $("#part-era").textContent = note || "";
  $("#part-era").hidden = !note;
}

/* ---------------- actions ---------------- */
function selectEra(id, carId) {
  state.era = id;
  renderEras();
  const first = carId || CARS.find((c) => c.era === id).id;
  selectCar(first);
}

async function selectCar(id) {
  const c = CARS.find((x) => x.id === id);
  if (!c) return;
  if (c.era !== state.era) { state.era = c.era; renderEras(); }
  state.car = id;
  state.part = null;
  try { history.replaceState(null, "", "#" + id); } catch (e) { /* sandboxed */ }
  renderEraInfo();
  renderCarInfo();
  renderPartCard();
  const token = ++state.token;
  const loading = $("#loading");
  loading.hidden = false;
  $("#load-bar").style.setProperty("--p", "0%");
  let car;
  try {
    car = await loadCar(MODEL_BASE + c.id + ".glb", (p) => $("#load-bar").style.setProperty("--p", Math.round(p * 100) + "%"), { length: c.length });
  } catch (e) {
    loading.querySelector("em").textContent = "Модель не загрузилась. Проверь соединение и выбери машину ещё раз.";
    return;
  }
  if (token !== state.token) return;
  loading.hidden = true;
  if (state.carObj) scene.remove(state.carObj);
  car.userData.era = c.year;
  splitParts(car);
  state.carObj = car;
  state.exploded = 0;
  state.target = 0;
  setExplode(car, 0);
  applyLivery(car, state.livery);
  scene.add(car);
  $("#explode").textContent = "Разобрать на детали";
  renderParts();
  // fly in from a low front angle to the hero three-quarter view
  const h = homeView();
  camera.position.set(7.5, 0.6, -2.5);
  controls.target.set(0, 0.45, 0);
  flyTo(h.pos, h.target, 1.6);
  controls.autoRotate = !REDUCED;
}

function selectPart(key, fromList) {
  state.part = key;
  if (state.carObj) highlight(state.carObj, key, !!key);
  renderParts();
  renderPartCard();
  if (!key || !state.carObj) return;
  controls.autoRotate = false;
  const box = partBox(state.carObj, key);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  const dir = camera.position.clone().sub(controls.target).normalize();
  if (key === "floor") dir.set(0.4, -0.15, 0.9).normalize();
  const dist = Math.max(3.4, size * 1.6);
  const pos = center.clone().addScaledVector(dir, dist);
  pos.y = Math.max(pos.y, 0.35);
  flyTo(pos, center, fromList ? 1.0 : 0.9);
}

$("#explode").addEventListener("click", () => {
  if (!state.carObj) return;
  state.target = state.target > 0.5 ? 0 : 1;
  $("#explode").textContent = state.target ? "Собрать болид" : "Разобрать на детали";
  const h = homeView(state.target ? 12.5 : 9.2);
  flyTo(h.pos, h.target, 1.2);
  if (!state.target) selectPart(null);
});

$("#reset").addEventListener("click", () => {
  const h = homeView(state.target ? 12.5 : 9.2);
  flyTo(h.pos, h.target, 1.0);
  selectPart(null);
  controls.autoRotate = !REDUCED;
});

/* ---------------- picking ---------------- */
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const tip = $("#tip");
let down = null;
function pick(e) {
  if (!state.carObj) return null;
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObject(state.carObj, true).filter((h) => h.object.visible && h.object.userData.part);
  return hits.length ? { part: hits[0].object.userData.part, x: e.clientX - r.left, y: e.clientY - r.top } : null;
}
renderer.domElement.addEventListener("pointermove", (e) => {
  if (e.pointerType !== "mouse") return;
  const h = pick(e);
  stageEl.classList.toggle("is-hover", !!h);
  if (h && PARTS[h.part]) {
    tip.textContent = PARTS[h.part].name;
    tip.style.left = h.x + "px";
    tip.style.top = h.y + "px";
    tip.classList.add("is-on");
    if (!state.part) highlight(state.carObj, h.part, true);
  } else {
    tip.classList.remove("is-on");
    if (!state.part) highlight(state.carObj, null, false);
  }
});
renderer.domElement.addEventListener("pointerleave", () => {
  tip.classList.remove("is-on");
  if (state.carObj && !state.part) highlight(state.carObj, null, false);
});
renderer.domElement.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; });
renderer.domElement.addEventListener("pointerup", (e) => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
  const h = pick(e);
  selectPart(h ? (h.part === state.part ? null : h.part) : null);
});

/* ---------------- credits ---------------- */
fetch(new URL("../data/model-credits.json", import.meta.url))
  .then((r) => r.json())
  .then((data) => {
    const ul = $("#credits");
    for (const c of CARS) {
      const m = data[c.id];
      if (!m) continue;
      const li = el("li");
      const a = el("a", null, m.name);
      a.href = m.url; a.target = "_blank"; a.rel = "noopener";
      const au = el("a", null, m.author);
      au.href = m.authorUrl; au.target = "_blank"; au.rel = "noopener";
      li.append(a, document.createTextNode(" — "), au, document.createTextNode(", " + m.license));
      ul.append(li);
    }
  })
  .catch(() => {});

/* ---------------- boot ---------------- */
renderLiveries();
const fromHash = CARS.find((c) => "#" + c.id === location.hash);
const start = fromHash || CARS.find((c) => c.id === "w17");
selectEra(start.era, start.id);
