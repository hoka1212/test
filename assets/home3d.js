import { THREE, createStage, loadCar, splitParts, setExplode, modelUrl } from "./f1-3d.js";
import { CARS } from "../data/cars.js";

const PW = window.PitWall;
const SEASON = window.F1_SEASON;
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = (s) => document.querySelector(s);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

// Track facts for the current calendar (length km, corners).
const TRACK_FACTS = {
  melbourne: [5.278, 14], shanghai: [5.451, 16], suzuka: [5.807, 18], miami: [5.412, 19], montreal: [4.361, 14],
  monaco: [3.337, 19], catalunya: [4.657, 14], spielberg: [4.318, 10], silverstone: [5.891, 18], "spa-francorchamps": [7.004, 19],
  hungaroring: [4.381, 14], zandvoort: [4.259, 14], monza: [5.793, 11], madring: [5.474, null], baku: [6.003, 20],
  sepang: [5.543, 15], "marina-bay": [4.94, 19], austin: [5.513, 20], "mexico-city": [4.304, 17], interlagos: [4.309, 15],
  "las-vegas": [6.201, 17], lusail: [5.419, 16], "yas-marina": [5.281, 16], bahrain: [5.412, 15], jeddah: [6.174, 27],
};

/* 2026 cars ordered by the constructors' standings */
const teamPos = Object.fromEntries((SEASON?.teams || []).map((t) => [t.id, t]));
const HERO_CARS = CARS.filter((c) => c.era === "active").sort((a, b) => (teamPos[a.teamId]?.pos ?? 99) - (teamPos[b.teamId]?.pos ?? 99));

function scrollProgress(section) {
  const r = section.getBoundingClientRect();
  const span = r.height - innerHeight;
  return span > 0 ? clamp01(-r.top / span) : 0;
}

/* =================== HERO =================== */
(function hero() {
  const section = $("#hero3d");
  const stageEl = $("#hero-stage");
  if (!section || !stageEl) return;
  const stage = createStage(stageEl, { theme: "light", transparent: true, fov: 30, exposure: 1.1 });
  const { camera, scene, renderer } = stage;
  stage.key.position.set(4, 10, 6);

  const state = { idx: 0, holder: null, leaving: null, enter: 0, yaw: 0, yawT: 0, tilt: 0, tiltT: 0, spin: 0, p: 0, token: 0 };
  const teams = $("#hero-teams");
  const caption = $("#hero-caption");
  const copy = $("#hero-copy");

  HERO_CARS.forEach((c, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "team-chip";
    b.setAttribute("role", "radio");
    b.style.setProperty("--team", c.color);
    const dot = document.createElement("i");
    b.append(dot, document.createTextNode(c.team));
    b.addEventListener("click", () => show(i));
    teams.append(b);
  });

  function markChips() {
    [...teams.children].forEach((b, i) => b.setAttribute("aria-checked", String(i === state.idx)));
  }

  async function show(i) {
    state.idx = (i + HERO_CARS.length) % HERO_CARS.length;
    markChips();
    const c = HERO_CARS[state.idx];
    const token = ++state.token;
    const car = await loadCar(modelUrl(c.id), null, { length: c.length });
    if (token !== state.token) return;
    const holder = new THREE.Group();
    holder.add(car);
    if (state.holder) {
      state.leaving = { obj: state.holder, t: 0 };
    }
    state.holder = holder;
    state.enter = REDUCED ? 1 : 0;
    holder.position.x = REDUCED ? 0 : -14;
    scene.add(holder);
    updateCaption();
  }

  function updateCaption() {
    const c = HERO_CARS[state.idx];
    if (!c) return;
    const t = teamPos[c.teamId];
    const p = state.p;
    let title = "", sub = "";
    if (p > 0.22 && p < 0.62) {
      title = c.name;
      sub = t ? `${t.pos}-е место в Кубке конструкторов ${SEASON.year}: ${fmt(t.points)} очков, побед: ${t.wins}. Пилоты — ${c.drivers}.` : c.drivers;
    } else if (p >= 0.62) {
      const race = PW?.nextRace?.();
      const circuit = race && PW.BY_ID[race.circuit];
      title = circuit ? `Дальше — круг по трассе ${circuit.name}` : "Дальше — круг по трассе";
      sub = "Листай, и камера проедет весь круг вместе с болидом.";
    }
    caption.classList.toggle("is-on", !!title);
    if (!title || caption.dataset.title === title) return;
    caption.dataset.title = title;
    const b = document.createElement("b");
    const span = document.createElement("span");
    b.textContent = title;
    span.textContent = sub;
    caption.replaceChildren(b, span);
  }
  const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1)).replace(".", ",");

  /* pointer: the car turns toward the cursor; a click swaps the team */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let down = null;
  const pin = section.querySelector(".hero3d-pin");
  pin.addEventListener("pointermove", (e) => {
    const r = pin.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ny = ((e.clientY - r.top) / r.height) * 2 - 1;
    state.yawT = nx * 0.45;
    state.tiltT = ny * 0.12;
    if (e.pointerType === "mouse") stageEl.classList.toggle("is-hover", !!hitCar(e));
  });
  pin.addEventListener("pointerleave", () => { state.yawT = 0; state.tiltT = 0; stageEl.classList.remove("is-hover"); });
  pin.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; });
  pin.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) return;
    if (e.target.closest("button, a")) return;
    if (hitCar(e)) {
      state.spin = 1; // a quick celebratory spin before the next car rolls in
      setTimeout(() => show(state.idx + 1), REDUCED ? 0 : 380);
    }
  });
  function hitCar(e) {
    if (!state.holder) return false;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.intersectObject(state.holder, true).length > 0;
  }

  /* scroll: the camera flies around the car */
  const keys = [
    new THREE.Vector3(7.6, 2.3, 6.4),
    new THREE.Vector3(2.2, 0.7, 4.6),
    new THREE.Vector3(-4.2, 1.0, 4.4),
    new THREE.Vector3(-7.2, 2.6, -1.6),
    new THREE.Vector3(-0.6, 10.5, 0.8),
  ];
  const looks = [
    new THREE.Vector3(0.4, 0.45, 0), new THREE.Vector3(0.6, 0.5, 0), new THREE.Vector3(-0.4, 0.55, 0),
    new THREE.Vector3(0, 0.6, 0), new THREE.Vector3(0, 0, 0),
  ];
  const path = new THREE.CatmullRomCurve3(keys, false, "centripetal");
  const look = new THREE.Vector3();

  stage.onTick((dt, now, raw) => {
    state.p = REDUCED ? 0 : scrollProgress(section);
    const p = state.p;
    // camera
    const aspectK = camera.aspect < 1 ? 1.55 : camera.aspect < 1.3 ? 1.2 : 1;
    const pos = path.getPointAt(ease(p));
    const seg = Math.min(looks.length - 2, Math.floor(ease(p) * (looks.length - 1)));
    const f = ease(p) * (looks.length - 1) - seg;
    look.lerpVectors(looks[seg], looks[seg + 1], f);
    camera.position.copy(pos).multiplyScalar(aspectK);
    // shift the car right of the headline on wide screens, centre it on phones
    const shift = camera.aspect > 1.3 ? (1 - smooth(0, 0.25, p)) * 1.4 : 0;
    camera.lookAt(look.x - shift * 0.6, look.y, look.z + shift);
    // cars
    state.yaw += (state.yawT - state.yaw) * Math.min(1, raw * 4);
    state.tilt += (state.tiltT - state.tilt) * Math.min(1, raw * 4);
    if (state.holder) {
      state.enter = Math.min(1, state.enter + raw / 0.9);
      const k = 1 - (1 - state.enter) ** 3;
      state.holder.position.x = -14 * (1 - k);
      state.spin = Math.max(0, state.spin - raw / 0.6);
      state.holder.rotation.y = state.yaw * (1 - smooth(0, 0.2, p)) + Math.sin(state.spin * Math.PI) * 0.6;
      state.holder.rotation.z = -state.tilt * 0.3 * (1 - smooth(0, 0.2, p));
    }
    if (state.leaving) {
      state.leaving.t += raw / 0.7;
      state.leaving.obj.position.x = 16 * state.leaving.t ** 2;
      if (state.leaving.t >= 1) { scene.remove(state.leaving.obj); state.leaving = null; }
    }
    // overlays
    copy.style.opacity = String(1 - smooth(0.04, 0.2, p));
    copy.style.transform = `translateY(${-40 * smooth(0, 0.2, p)}px)`;
    teams.style.opacity = String(1 - smooth(0.55, 0.7, p));
    $("#hero-hint").style.opacity = String(1 - smooth(0.05, 0.15, p));
    updateCaption();
  });

  show(0);
})();

/* =================== FLY-OVER =================== */
(function flyover() {
  const section = $("#flyover");
  const stageEl = $("#fly-stage");
  if (!section || !stageEl || !PW) return;
  const race = PW.nextRace() || SEASON.races[SEASON.races.length - 1];
  const circuit = PW.BY_ID[race.circuit];
  if (!circuit) { section.hidden = true; return; }
  const layout = PW.latestLayout(circuit);

  // HUD text
  const facts = TRACK_FACTS[circuit.id] || [];
  const first = Math.min(...circuit.layouts.flatMap((l) => (l.seasons.match(/\d{4}/g) || []).map(Number)));
  $("#fly-title").textContent = `Круг по трассе ${circuit.name}`;
  const stats = $("#fly-stats");
  const addStat = (k, v) => { if (v == null) return; const d = document.createElement("div"); const dt = document.createElement("dt"); const dd = document.createElement("dd"); dt.textContent = k; dd.textContent = v; d.append(dt, dd); stats.append(d); };
  addStat("Длина круга", facts[0] ? `${String(facts[0]).replace(".", ",")} км` : null);
  addStat("Поворотов", facts[1]);
  addStat("Первый Гран-при", Number.isFinite(first) ? first : null);
  const bar = $("#fly-bar");
  const note = $("#fly-note");

  // sample the circuit outline
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", "0"); svg.setAttribute("height", "0");
  svg.style.position = "absolute";
  const pathEl = document.createElementNS(svgNS, "path");
  pathEl.setAttribute("d", layout.d);
  svg.append(pathEl);
  document.body.append(svg);
  const total = pathEl.getTotalLength();
  const N = 900, S = 0.9;
  const pts = [];
  for (let i = 0; i < N; i++) {
    const q = pathEl.getPointAtLength((i / N) * total);
    pts.push(new THREE.Vector3((q.x - 250) * S, 0, (q.y - 250) * S));
  }
  svg.remove();
  const curve = new THREE.CatmullRomCurve3(pts, true, "centripetal", 0.5);

  const stage = createStage(stageEl, { theme: "light", transparent: true, fov: 42, exposure: 1.08, ground: false, fog: [0xe6eef7, 260, 1100], maxDpr: 1.6 });
  const { camera, scene } = stage;
  stage.key.position.set(60, 140, 40);
  stage.key.shadow.camera.left = -30; stage.key.shadow.camera.right = 30; stage.key.shadow.camera.top = 30; stage.key.shadow.camera.bottom = -30;
  stage.key.shadow.camera.far = 400;

  // ground with a faint grid
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), new THREE.MeshStandardMaterial({ color: 0xdfe9df, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new THREE.GridHelper(1600, 160, 0xc9d8c9, 0xd3e0d3);
  grid.position.y = 0.01;
  scene.add(grid);

  function ribbon(width, y, color, opts = {}) {
    const n = 1400;
    const pos = new Float32Array((n + 1) * 2 * 3);
    const idx = [];
    const tan = new THREE.Vector3(), nor = new THREE.Vector3(), p = new THREE.Vector3();
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      curve.getPointAt(u % 1, p);
      curve.getTangentAt(u % 1, tan);
      nor.set(-tan.z, 0, tan.x).normalize();
      const off = opts.offset || 0;
      const a = p.clone().addScaledVector(nor, off - width / 2), b = p.clone().addScaledVector(nor, off + width / 2);
      pos.set([a.x, y, a.z, b.x, y, b.z], i * 6);
      if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, opts.material || new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
    m.receiveShadow = true;
    m.userData.tris = idx.length;
    scene.add(m);
    return m;
  }
  ribbon(14, 0.03, 0x3a4250);                         // asphalt
  ribbon(1.2, 0.04, 0xe1062c, { offset: 7.6 });       // kerb-red run-off strip
  const trace = ribbon(2.0, 0.07, 0, { material: new THREE.MeshBasicMaterial({ color: 0x1d6cf2 }) });
  trace.geometry.setDrawRange(0, 0);

  // start/finish line
  const sf = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 14), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  sf.rotation.x = -Math.PI / 2;
  const t0 = curve.getTangentAt(0);
  sf.rotation.z = Math.atan2(t0.x, t0.z) + Math.PI / 2;
  sf.position.copy(curve.getPointAt(0)).setY(0.06);
  scene.add(sf);

  // the car
  const holder = new THREE.Group();
  scene.add(holder);
  const carDef = HERO_CARS[0];
  loadCar(modelUrl(carDef.id), null, { length: carDef.length }).then((car) => {
    car.scale.setScalar(2.2);
    holder.add(car);
  });

  const notes = [
    [0, "Сверху видна вся трасса. Листай дальше, и камера спустится к болиду."],
    [0.14, "Старт-финиш. Болид уходит на круг."],
    [0.4, "Первый сектор позади. Синяя линия — уже пройденная часть круга."],
    [0.66, "Последний сектор, финишная прямая уже близко."],
    [0.9, "Круг завершён. Камера поднимается, чтобы показать весь круг целиком."],
  ];
  const cam = new THREE.Vector3(), lookAt = new THREE.Vector3(), p = new THREE.Vector3(), tan = new THREE.Vector3();
  const overview = new THREE.Vector3(0, 330, 250);
  stage.onTick(() => {
    const prog = REDUCED ? 0.5 : scrollProgress(section);
    const u = smooth(0.12, 0.88, prog);
    curve.getPointAt(u % 1, p);
    curve.getTangentAt(u % 1, tan);
    holder.position.copy(p);
    holder.rotation.y = Math.atan2(-tan.z, tan.x);
    // chase camera blended with the overview at both ends
    const chase = p.clone().addScaledVector(tan, -26).add(new THREE.Vector3(0, 10, 0));
    const chaseLook = p.clone().addScaledVector(tan, 14);
    const w = smooth(0, 0.14, prog) * (1 - smooth(0.86, 1, prog));
    cam.lerpVectors(overview, chase, w);
    lookAt.lerpVectors(new THREE.Vector3(0, 0, 0), chaseLook, w);
    camera.position.copy(cam);
    camera.lookAt(lookAt);
    stage.key.target.position.copy(p);
    stage.key.position.copy(p).add(new THREE.Vector3(30, 60, 20));
    stage.key.target.updateMatrixWorld();
    trace.geometry.setDrawRange(0, Math.floor(trace.userData.tris * u / 3) * 3);
    bar.style.width = (u * 100).toFixed(1) + "%";
    let txt = notes[0][1];
    for (const [at, t] of notes) if (prog >= at) txt = t;
    if (note.textContent !== txt) note.textContent = txt;
  });
  scene.add(stage.key.target);
})();

/* =================== ANATOMY BANNER =================== */
(function banner() {
  const el = $("#ab-stage");
  if (!el) return;
  let started = false;
  const io = new IntersectionObserver((entries) => {
    if (started || !entries[0].isIntersecting) return;
    started = true;
    io.disconnect();
    const stage = createStage(el, { theme: "dark", transparent: true, fov: 30, ground: false, maxDpr: 1.6 });
    const def = CARS.find((c) => c.id === "f2004");
    loadCar(modelUrl(def.id), null, { length: def.length }).then((car) => {
      car.userData.era = def.year;
      splitParts(car);
      stage.scene.add(car);
      stage.onTick((dt, now) => {
        const t = REDUCED ? 0.6 : 0.5 + 0.5 * Math.sin(now * 0.6);
        setExplode(car, t * 0.85);
        car.rotation.y = REDUCED ? 0.6 : now * 0.18;
      });
    });
    stage.camera.position.set(6.5, 3.4, 7.5);
    stage.camera.lookAt(0, 0.6, 0);
  }, { rootMargin: "200px" });
  io.observe(el);
})();
