/* PIT WALL procedural F1 car builder (three.js r158 UMD, global THREE).
   Builds a car of any era from a parameter "kit", painted with a livery, split into named parts
   so the anatomy viewer can explode it. Units are metres, +X points forward, +Y up, Z across. */
(function () {
  "use strict";
  const T = THREE;

  /* ---------------- geometry helpers ---------------- */

  // Catmull-Rom interpolation of numeric station fields so a few key sections loft into a smooth body.
  function smoothStations(st, sub) {
    if (st.length < 3) return st;
    const keys = Object.keys(st[0]).filter((k) => typeof st[0][k] === "number");
    const out = [];
    for (let i = 0; i < st.length - 1; i++) {
      const p0 = st[Math.max(0, i - 1)], p1 = st[i], p2 = st[i + 1], p3 = st[Math.min(st.length - 1, i + 2)];
      for (let s = 0; s < sub; s++) {
        const t = s / sub, t2 = t * t, t3 = t2 * t;
        const o = {};
        for (const k of keys) {
          const a = p0[k] ?? p1[k], b = p1[k], c = p2[k], d = p3[k] ?? p2[k];
          o[k] = 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        }
        out.push(o);
      }
    }
    out.push(Object.assign({}, st[st.length - 1]));
    return out;
  }

  // Loft super-elliptic cross-sections along X. Station: {x, w, top, bot, e(=2 ellipse, 4+ boxy), z?}
  function loft(stations, opt = {}) {
    const seg = opt.seg || 28;
    const st = smoothStations(stations, opt.sub || 6);
    const pos = [];
    const idx = [];
    for (const s of st) {
      const e = Math.max(1.2, s.e || 2.4);
      const cy = (s.top + s.bot) / 2, hh = Math.max(0.001, (s.top - s.bot) / 2), hw = Math.max(0.001, s.w / 2);
      const flat = s.flat || 0; // flattens the underside (0..1)
      for (let j = 0; j < seg; j++) {
        const a = (j / seg) * Math.PI * 2;
        const c = Math.cos(a), sn = Math.sin(a);
        let y = Math.sign(sn) * Math.pow(Math.abs(sn), 2 / e) * hh;
        const z = Math.sign(c) * Math.pow(Math.abs(c), 2 / e) * hw;
        if (y < 0 && flat) y = y * (1 - flat) - hh * flat * Math.min(1, Math.abs(sn) * 3);
        pos.push(s.x, cy + y, (s.z || 0) + z);
      }
    }
    const rings = st.length;
    for (let i = 0; i < rings - 1; i++) {
      for (let j = 0; j < seg; j++) {
        const a = i * seg + j, b = i * seg + ((j + 1) % seg), c = (i + 1) * seg + j, d = (i + 1) * seg + ((j + 1) % seg);
        idx.push(a, c, b, b, c, d);
      }
    }
    // caps
    const capF = pos.length / 3; pos.push(st[0].x, (st[0].top + st[0].bot) / 2, st[0].z || 0);
    const capB = pos.length / 3; pos.push(st[rings - 1].x, (st[rings - 1].top + st[rings - 1].bot) / 2, st[rings - 1].z || 0);
    for (let j = 0; j < seg; j++) {
      idx.push(capF, j, (j + 1) % seg);
      const base = (rings - 1) * seg;
      idx.push(capB, base + ((j + 1) % seg), base + j);
    }
    // Make sure triangles wind outward (positive signed volume) whatever the station order.
    let vol = 0;
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      vol += pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1]) - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c]) + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
    }
    if (vol < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  function airfoilShape(chord, thick, camber = 0.04) {
    const s = new T.Shape();
    const n = 18;
    const upper = [], lower = [];
    for (let i = 0; i <= n; i++) {
      const x = 1 - Math.cos((i / n) * Math.PI / 2 * 2) ; // 0..2 -> remap
      const t = i / n;
      const xx = (1 - Math.cos(t * Math.PI)) / 2;
      const yt = 5 * thick * (0.2969 * Math.sqrt(xx) - 0.126 * xx - 0.3516 * xx * xx + 0.2843 * xx ** 3 - 0.1015 * xx ** 4);
      const yc = camber * (xx < 0.4 ? (2 * 0.4 * xx - xx * xx) / 0.16 : ((1 - 0.8) + 0.8 * xx - xx * xx) / 0.36);
      upper.push([xx, yc + yt]);
      lower.push([xx, yc - yt]);
      void x;
    }
    s.moveTo(-upper[0][0] * chord, upper[0][1] * chord);
    for (const [x, y] of upper) s.lineTo(-x * chord, y * chord);
    for (let i = lower.length - 1; i >= 0; i--) s.lineTo(-lower[i][0] * chord, lower[i][1] * chord);
    return s;
  }

  // A wing element: airfoil (leading edge at x=0, trailing toward -x) extruded across span (Z), angled by aoa.
  function wingElement(chord, span, thick, aoa, mat, camber) {
    const g = new T.ExtrudeGeometry(airfoilShape(chord, thick, camber), { depth: span, bevelEnabled: false, steps: 1 });
    g.translate(0, 0, -span / 2);
    const m = new T.Mesh(g, mat);
    m.rotation.z = -aoa; // positive aoa: trailing edge up (downforce)
    return m;
  }

  function box(w, h, d, mat, r) {
    const g = r ? roundedBox(w, h, d, r) : new T.BoxGeometry(w, h, d);
    return new T.Mesh(g, mat);
  }

  function roundedBox(w, h, d, r) {
    const shape = new T.Shape();
    const x = -w / 2, y = -h / 2;
    r = Math.min(r, w / 2, h / 2);
    shape.moveTo(x + r, y);
    shape.lineTo(x + w - r, y); shape.quadraticCurveTo(x + w, y, x + w, y + r);
    shape.lineTo(x + w, y + h - r); shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    shape.lineTo(x + r, y + h); shape.quadraticCurveTo(x, y + h, x, y + h - r);
    shape.lineTo(x, y + r); shape.quadraticCurveTo(x, y, x + r, y);
    const g = new T.ExtrudeGeometry(shape, { depth: d, bevelEnabled: true, bevelSize: Math.min(r, d / 4), bevelThickness: Math.min(r, d / 4), bevelSegments: 2, curveSegments: 4 });
    g.translate(0, 0, -d / 2);
    return g;
  }

  function rod(a, b, r, mat) {
    const dir = new T.Vector3().subVectors(b, a);
    const len = dir.length();
    const g = new T.CylinderGeometry(r, r, len, 8, 1);
    const m = new T.Mesh(g, mat);
    m.position.copy(a).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir.normalize());
    return m;
  }

  /* ---------------- textures ---------------- */

  const texCache = {};
  function canvasTex(key, w, h, draw) {
    if (texCache[key]) return texCache[key];
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    draw(c.getContext("2d"), w, h);
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = 4;
    texCache[key] = t;
    return t;
  }

  function spokeTex() {
    return canvasTex("spokes", 256, 256, (g, w) => {
      g.clearRect(0, 0, w, w);
      g.strokeStyle = "#d9dde3";
      g.lineWidth = 2;
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2, b = a + (i % 2 ? 0.35 : -0.35);
        g.beginPath();
        g.moveTo(128 + Math.cos(a) * 26, 128 + Math.sin(a) * 26);
        g.lineTo(128 + Math.cos(b) * 122, 128 + Math.sin(b) * 122);
        g.stroke();
      }
      g.lineWidth = 8;
      g.beginPath(); g.arc(128, 128, 122, 0, Math.PI * 2); g.stroke();
      g.fillStyle = "#c8cdd4";
      g.beginPath(); g.arc(128, 128, 28, 0, Math.PI * 2); g.fill();
    });
  }

  function roundelTex(num, bg, fg) {
    return canvasTex(`roundel-${num}-${bg}-${fg}`, 256, 256, (g, w) => {
      g.clearRect(0, 0, w, w);
      if (bg !== "none") {
        g.fillStyle = bg;
        g.beginPath(); g.arc(128, 128, 120, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = fg;
      g.font = bg === "none" ? "italic 900 170px Arial, sans-serif" : "bold 150px Arial, sans-serif";
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(String(num), 128, 140);
    });
  }

  function treadTex(grooves) {
    return canvasTex("tread-" + grooves, 64, 256, (g, w, h) => {
      g.fillStyle = "#17181b"; g.fillRect(0, 0, w, h);
      if (!grooves) return;
      g.fillStyle = "#050506";
      for (let i = 1; i <= grooves; i++) g.fillRect(0, (i * h) / (grooves + 1) - 4, w, 8);
    });
  }

  /* ---------------- materials ---------------- */

  function makeMaterials(livery) {
    const paint = (hex, rough = 0.32) => new T.MeshPhysicalMaterial({ color: hex, metalness: 0.15, roughness: rough, clearcoat: 1, clearcoatRoughness: 0.06 });
    return {
      primary: paint(livery.primary),
      secondary: paint(livery.secondary),
      accent: paint(livery.accent || livery.secondary),
      carbon: new T.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.45, metalness: 0.3 }),
      rubber: new T.MeshStandardMaterial({ color: 0x18191c, roughness: 0.92, metalness: 0 }),
      metal: new T.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.25, metalness: 1 }),
      darkMetal: new T.MeshStandardMaterial({ color: 0x55595f, roughness: 0.35, metalness: 0.9 }),
      gold: new T.MeshStandardMaterial({ color: 0xd8b25a, roughness: 0.3, metalness: 1 }),
      engine: new T.MeshStandardMaterial({ color: 0xaab0b8, roughness: 0.35, metalness: 0.85 }),
      engineRed: new T.MeshStandardMaterial({ color: 0xb3262e, roughness: 0.4, metalness: 0.4 }),
      black: new T.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.6 }),
      glass: new T.MeshPhysicalMaterial({ color: 0xbfd6e6, roughness: 0.05, transmission: 0.6, transparent: true, opacity: 0.45, metalness: 0 }),
      visor: new T.MeshPhysicalMaterial({ color: 0x111418, roughness: 0.08, metalness: 0.6, clearcoat: 1 }),
      helmet: paint(livery.helmet || "#f3f3f0", 0.25),
      seat: new T.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.8 }),
      glow: new T.MeshStandardMaterial({ color: 0x48d6ff, emissive: 0x2fb8ff, emissiveIntensity: 1.6, roughness: 0.4 }),
      rain: new T.MeshStandardMaterial({ color: 0xff2040, emissive: 0xff1030, emissiveIntensity: 2.2 }),
      mirror: new T.MeshStandardMaterial({ color: 0xdfe7f0, metalness: 1, roughness: 0.05 }),
      spokes: new T.MeshStandardMaterial({ map: spokeTex(), transparent: true, alphaTest: 0.3, metalness: 0.9, roughness: 0.3, side: T.DoubleSide }),
    };
  }

  /* ---------------- components ---------------- */

  function tyreGeometry(r, w, sidewall, grooves) {
    const ri = r - sidewall;
    const pts = [];
    const c = Math.min(w * 0.22, sidewall * 0.45);
    pts.push(new T.Vector2(ri, -w / 2 + 0.01));
    pts.push(new T.Vector2(r - c, -w / 2));
    for (let i = 0; i <= 6; i++) {
      const a = Math.PI + (i / 6) * (Math.PI / 2);
      pts.push(new T.Vector2(r - c - Math.cos(a) * c - c, -w / 2 + c + Math.sin(a) * c));
    }
    pts.push(new T.Vector2(r, 0));
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * (Math.PI / 2);
      pts.push(new T.Vector2(r - c + Math.sin(a) * c, w / 2 - c + Math.cos(a) * c - c + c));
    }
    pts.push(new T.Vector2(r - c, w / 2));
    pts.push(new T.Vector2(ri, w / 2 - 0.01));
    void grooves;
    const g = new T.LatheGeometry(pts, 40);
    g.rotateX(Math.PI / 2);
    return g;
  }

  function makeWheel(o, M) {
    const g = new T.Group();
    const tyreMat = o.grooves ? new T.MeshStandardMaterial({ map: treadTex(o.grooves), roughness: 0.9 }) : M.rubber;
    const tyre = new T.Mesh(tyreGeometry(o.r, o.w, o.sidewall, o.grooves), tyreMat);
    g.add(tyre);
    const rimR = o.r - o.sidewall;
    if (o.style === "wire") {
      const rim = new T.Mesh(new T.CylinderGeometry(rimR, rimR, o.w * 0.86, 32, 1, true), M.metal);
      rim.rotation.x = Math.PI / 2;
      g.add(rim);
      for (const s of [-1, 1]) {
        const disc = new T.Mesh(new T.CircleGeometry(rimR * 0.98, 32), M.spokes);
        disc.position.z = (s * o.w) / 2.6;
        g.add(disc);
      }
      const spinner = new T.Mesh(new T.ConeGeometry(0.055, 0.09, 3), M.metal);
      spinner.rotation.x = Math.PI / 2;
      spinner.position.z = o.w / 2 + 0.04;
      spinner.userData.outboard = true;
      g.add(spinner);
    } else {
      const rim = new T.Mesh(new T.CylinderGeometry(rimR, rimR * 0.94, o.w * 0.9, 32), o.style === "modern" ? M.black : M.darkMetal);
      rim.rotation.x = Math.PI / 2;
      g.add(rim);
      const face = new T.Mesh(new T.CylinderGeometry(rimR * 0.92, rimR * 0.92, 0.02, 32), o.style === "modern" ? M.carbon : M.metal);
      face.rotation.x = Math.PI / 2;
      face.position.z = o.w * 0.42;
      face.userData.outboard = true;
      g.add(face);
      const nut = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 0.06, 6), o.style === "modern" ? M.accent : M.gold);
      nut.rotation.x = Math.PI / 2;
      nut.position.z = o.w * 0.45 + 0.03;
      nut.userData.outboard = true;
      g.add(nut);
    }
    return g;
  }

  function makeEngine(type, M, scale = 1) {
    const g = new T.Group();
    const spec = {
      I4: { n: 4, banks: 1, ang: 0 }, I6: { n: 6, banks: 1, ang: 0 }, I8: { n: 8, banks: 1, ang: 0 },
      V6: { n: 6, banks: 2, ang: 0.6 }, V8: { n: 8, banks: 2, ang: 0.7 }, V10: { n: 10, banks: 2, ang: 0.62 },
      V12: { n: 12, banks: 2, ang: 0.55 }, F12: { n: 12, banks: 2, ang: 1.57 }, H16: { n: 16, banks: 2, ang: 1.57 },
    }[type.replace("T", "")] || { n: 8, banks: 2, ang: 0.7 };
    const turbo = /T$/.test(type);
    const len = (0.11 * spec.n) / spec.banks + 0.12;
    const block = box(len, 0.24, 0.3, M.engine, 0.04);
    block.position.y = 0.0;
    g.add(block);
    const perBank = spec.n / spec.banks;
    for (let b = 0; b < spec.banks; b++) {
      const side = spec.banks === 1 ? 0 : b ? 1 : -1;
      const head = box(len * 0.96, 0.08, 0.16, spec.banks === 1 ? M.engineRed : M.engine, 0.02);
      const ang = side * spec.ang;
      head.position.set(0, 0.16 * Math.cos(ang) + 0.02, 0.2 * Math.sin(ang));
      head.rotation.x = -ang;
      g.add(head);
      for (let i = 0; i < perBank; i++) {
        const x = -len / 2 + (len / perBank) * (i + 0.5);
        const tr = new T.Mesh(new T.CylinderGeometry(0.026, 0.034, turbo ? 0.06 : 0.14, 10, 1, true), M.metal);
        tr.position.set(x, 0.26 * Math.cos(ang * 0.6) + 0.04, 0.12 * Math.sin(ang) * (spec.banks === 1 ? 0 : 1) + (spec.banks === 1 ? -0.06 : 0));
        tr.rotation.x = -ang * 0.6;
        g.add(tr);
      }
    }
    if (turbo) {
      for (const s of spec.banks === 1 ? [1] : [-1, 1]) {
        const tb = new T.Mesh(new T.TorusGeometry(0.07, 0.035, 10, 20), M.darkMetal);
        tb.position.set(-len / 2 - 0.02, 0.0, s * 0.26);
        tb.rotation.y = Math.PI / 2;
        g.add(tb);
      }
    }
    g.scale.setScalar(scale);
    g.userData.length = len * scale;
    return g;
  }

  function makeDriver(o, M) {
    const g = new T.Group();
    const helmet = new T.Mesh(new T.SphereGeometry(0.135, 24, 18), M.helmet);
    helmet.scale.set(1.08, 1, 0.95);
    g.add(helmet);
    if (o.full) {
      const visor = new T.Mesh(new T.SphereGeometry(0.137, 24, 10, -0.9, 1.8, 1.25, 0.42), M.visor);
      visor.rotation.y = Math.PI / 2;
      visor.scale.set(1.08, 1, 0.95);
      g.add(visor);
    } else {
      helmet.scale.set(1.04, 0.86, 0.94);
      helmet.position.y = 0.02;
      const goggles = new T.Mesh(new T.TorusGeometry(0.11, 0.02, 8, 20, Math.PI), M.visor);
      goggles.rotation.set(0, Math.PI / 2, 0);
      goggles.position.set(0.04, -0.02, 0);
      g.add(goggles);
      const face = new T.Mesh(new T.SphereGeometry(0.11, 16, 12), new T.MeshStandardMaterial({ color: 0xd6a989, roughness: 0.7 }));
      face.position.set(0.03, -0.06, 0);
      g.add(face);
    }
    const shoulders = new T.Mesh(new T.CapsuleGeometry(0.14, 0.24, 6, 12), M.seat);
    shoulders.rotation.x = Math.PI / 2;
    shoulders.position.set(-0.05, -0.24, 0);
    g.add(shoulders);
    return g;
  }

  /* ---------------- the builder ---------------- */

  function merge(a, b) {
    const o = Array.isArray(a) ? a.slice() : Object.assign({}, a);
    for (const k in b) {
      if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) && a && typeof a[k] === "object" && !Array.isArray(a[k])) o[k] = merge(a[k], b[k]);
      else o[k] = b[k];
    }
    return o;
  }

  function finGeometry(x0, x1, yBase0, yTop0, yBase1, yTop1, t) {
    const sh = new T.Shape();
    sh.moveTo(x0, yBase0); sh.lineTo(x0, yTop0); sh.lineTo(x1, yTop1); sh.lineTo(x1, yBase1); sh.lineTo(x0, yBase0);
    const g = new T.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false });
    g.translate(0, 0, -t / 2);
    return g;
  }

  function buildCar(spec, livery) {
    const K = merge(KITS[spec.kit], spec.overrides || {});
    const L = Object.assign({ pattern: "solid" }, livery);
    const M = makeMaterials(L);
    const mat = (role, fallback) => {
      switch (role || fallback) {
        case "secondary": return M.secondary;
        case "accent": return M.accent;
        case "carbon": return M.carbon;
        case "black": return M.black;
        default: return M.primary;
      }
    };
    const root = new T.Group();
    const parts = {};
    const add = (key, obj, explode) => {
      if (!parts[key]) {
        const grp = new T.Group();
        grp.name = key;
        grp.userData = { part: key, explode: new T.Vector3().fromArray(EXPLODE[key] || [0, 0, 0]), home: new T.Vector3() };
        parts[key] = grp;
        root.add(grp);
      }
      parts[key].add(obj);
      obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.userData.part = key; } });
      void explode;
      return obj;
    };

    const wb = K.wheelbase, fa = wb / 2, ra = -wb / 2;
    const tf = K.trackF, tr = K.trackR;
    const rF = K.tyreF.r, rR = K.tyreR.r;
    const B = K.body;
    const ck = K.cockpit;
    const flaps = [];

    /* --- wheels, covers, suspension --- */
    const wheelSpots = [];
    for (const s of [-1, 1]) wheelSpots.push({ x: fa, z: (s * tf) / 2, t: K.tyreF, s, front: true });
    for (const s of [-1, 1]) wheelSpots.push({ x: ra, z: (s * tr) / 2, t: K.tyreR, s, front: false });
    const wheels = [];
    for (const w of wheelSpots) {
      const wh = makeWheel({ r: w.t.r, w: w.t.w, sidewall: w.t.side, style: K.wheelStyle, grooves: K.grooves }, M);
      if (K.covers) {
        const cover = new T.Mesh(new T.CircleGeometry(w.t.r - w.t.side + 0.005, 40), mat(L.covers, "carbon"));
        cover.position.z = w.t.w / 2 - 0.01;
        wh.add(cover);
        const ring = new T.Mesh(new T.RingGeometry(w.t.r - w.t.side - 0.035, w.t.r - w.t.side - 0.012, 40), M.accent);
        ring.position.z = w.t.w / 2 - 0.005;
        wh.add(ring);
      }
      wh.position.set(w.x, w.t.r, w.z);
      if (w.s < 0) wh.rotation.y = Math.PI;
      wheels.push(wh);
      add("wheels", wh);
      wh.userData.explodeSelf = new T.Vector3(w.front ? 0.45 : -0.45, 0, w.s * 1.05);
      const inner = K.chassisW / 2 - 0.02;
      const y = w.t.r;
      const hub = new T.Vector3(w.x, y, w.z - w.s * (w.t.w / 2 + 0.03));
      const topY = w.front ? y + 0.13 : y + 0.16, botY = y - 0.12;
      const a1 = new T.Vector3(w.x + 0.24, topY, w.s * inner), a2 = new T.Vector3(w.x - 0.24, topY, w.s * inner);
      const b1 = new T.Vector3(w.x + 0.28, botY, w.s * inner), b2 = new T.Vector3(w.x - 0.28, botY, w.s * inner);
      const up = hub.clone().add(new T.Vector3(0, 0.11, 0)), dn = hub.clone().add(new T.Vector3(0, -0.1, 0));
      const links = [[a1, up], [a2, up], [b1, dn], [b2, dn]];
      if (w.front) links.push([new T.Vector3(w.x - 0.05, y + 0.02, w.s * inner), hub.clone().add(new T.Vector3(-0.08, 0, 0))]);
      else links.push([new T.Vector3(w.x + 0.15, y + 0.05, w.s * inner), up.clone().add(new T.Vector3(0.08, -0.05, 0))]);
      for (const [a, b] of links) {
        const r = add("suspension", rod(a, b, 0.016, M.carbon));
        r.userData.explodeSelf = new T.Vector3(0, 0, w.s * 0.55);
      }
      const upright = box(0.12, 0.26, 0.05, M.darkMetal, 0.02);
      upright.position.copy(hub);
      upright.userData.explodeSelf = new T.Vector3(0, 0, w.s * 0.55);
      add("suspension", upright);
    }

    /* --- body: nose / chassis / engine cover --- */
    const all = B.stations.map((q) => Object.assign({}, q));
    const pick = (from, to) => all.filter((q) => q.x <= from + 1e-6 && q.x >= to - 1e-6);
    const noseSt = pick(99, B.noseSplit), midSt = pick(B.noseSplit, B.tailSplit), tailSt = pick(B.tailSplit, -99);
    add("nose", new T.Mesh(loft(noseSt, { seg: 36 }), mat(L.nose, "primary")));
    add("chassis", new T.Mesh(loft(midSt, { seg: 40 }), M.primary));
    if (tailSt.length > 1) add("cover", new T.Mesh(loft(tailSt, { seg: 36 }), mat(L.cover, "primary")));

    if (K.tusks) {
      // Williams FW26 "walrus" nose: two tusks carry the front wing.
      for (const s of [-1, 1]) {
        const pts = [new T.Vector3(noseSt[0].x + 0.02, (noseSt[0].top + noseSt[0].bot) / 2, s * 0.06), new T.Vector3(K.frontWing.x - 0.15, K.frontWing.y + 0.12, s * 0.3)];
        add("nose", new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3([pts[0], pts[0].clone().lerp(pts[1], 0.5).add(new T.Vector3(0, 0.03, 0)), pts[1]]), 20, 0.05, 10), mat(L.nose, "primary")));
      }
    }

    if (L.pattern === "stripe" || L.pattern === "twin") {
      const offs = L.pattern === "twin" ? [-0.08, 0.08] : [0];
      const st = all.filter((q) => q.w > 0.22);
      for (const zo of offs) {
        const pts = st.map((q) => new T.Vector3(q.x, q.top + 0.004, zo));
        add("chassis", new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 80, 0.03, 6, false), M.secondary));
      }
    }

    /* --- sidepods with livery band, chimneys, horns --- */
    if (K.sidepods) {
      const sp = K.sidepods;
      for (const s of [-1, 1]) {
        const g = new T.Group();
        const st = sp.stations.map((q) => Object.assign({}, q, { z: s * sp.z }));
        g.add(new T.Mesh(loft(st, { seg: 30 }), mat(L.pods, "primary")));
        const f = st[0];
        const inlet = new T.Mesh(new T.CircleGeometry(1, 28), M.black);
        inlet.scale.set((f.top - f.bot) * 0.38, f.w * 0.4, 1);
        inlet.rotation.set(0, Math.PI / 2, Math.PI / 2);
        inlet.position.set(f.x + 0.006, (f.top + f.bot) / 2, f.z);
        g.add(inlet);
        if (L.podBand) {
          const band = new T.Mesh(loft(st.slice(1, 3).map((q) => Object.assign({}, q, { w: q.w + 0.006, top: q.top + 0.003, bot: q.bot + (q.top - q.bot) * 0.55 })), { seg: 30 }), M.secondary);
          g.add(band);
        }
        if (K.chimneys) {
          const c = new T.Mesh(new T.CylinderGeometry(0.05, 0.06, 0.12, 14), M.carbon);
          c.position.set(st[2].x + 0.2, st[2].top + 0.04, s * sp.z);
          g.add(c);
        }
        if (K.horns) {
          const h = wingElement(0.18, 0.18, 0.08, 0.3, M.carbon);
          h.position.set(st[1].x + 0.05, st[1].top + 0.18, s * (sp.z - 0.05));
          g.add(h);
          g.add(rod(new T.Vector3(st[1].x - 0.02, st[1].top, s * (sp.z - 0.05)), new T.Vector3(st[1].x - 0.02, st[1].top + 0.18, s * (sp.z - 0.05)), 0.01, M.carbon));
        }
        const o = add("sidepods", g);
        o.userData.explodeSelf = new T.Vector3(0, 0.12, s * 0.95);
      }
    }

    if (K.bargeboards) {
      for (const s of [-1, 1]) {
        const g = new T.Group();
        for (let i = 0; i < 3; i++) {
          const p = box(0.32 - i * 0.06, 0.24 - i * 0.04, 0.008, M.carbon, 0.02);
          p.position.set(fa - 0.6 - i * 0.12, 0.2 + i * 0.03, s * (K.chassisW / 2 + 0.12 + i * 0.07));
          p.rotation.y = s * 0.12;
          g.add(p);
        }
        const o = add("bargeboards", g);
        o.userData.explodeSelf = new T.Vector3(0.1, 0, s * 0.65);
      }
    }

    /* --- floor & diffuser --- */
    if (K.floor) {
      const fl = K.floor;
      const g = new T.Group();
      const plank = box(fl.len, 0.025, fl.w, M.carbon, 0.01);
      plank.position.set(fl.x, fl.y, 0);
      g.add(plank);
      if (fl.fences) {
        for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
          const fe = box(0.5, 0.12, 0.008, M.carbon);
          fe.position.set(fl.x + fl.len / 2 - 0.35, fl.y + 0.06, s * (0.32 + i * 0.09));
          fe.rotation.y = s * (0.05 + i * 0.04);
          g.add(fe);
        }
        for (const s of [-1, 1]) {
          const edge = box(fl.len * 0.7, 0.05, 0.012, M.carbon);
          edge.position.set(fl.x - fl.len * 0.05, fl.y + 0.05, s * fl.w / 2);
          g.add(edge);
        }
      }
      for (let i = -2; i <= 2; i++) {
        const fin = box(0.4, 0.1, 0.008, M.carbon);
        fin.position.set(fl.x - fl.len / 2 - 0.12, fl.y + 0.08, i * 0.15);
        fin.rotation.z = 0.3;
        g.add(fin);
      }
      const ramp = box(0.44, 0.012, fl.w * 0.62, M.carbon);
      ramp.position.set(fl.x - fl.len / 2 - 0.14, fl.y + 0.12, 0);
      ramp.rotation.z = -0.34;
      g.add(ramp);
      add("floor", g);
    }

    /* --- cockpit, driver, halo, mirrors --- */
    const opening = new T.Mesh(new T.SphereGeometry(1, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.black);
    opening.scale.set(ck.len / 2, 0.05, ck.w / 2);
    opening.position.set(ck.x, ck.rim - 0.03, 0);
    add("chassis", opening);
    const driver = makeDriver({ full: true }, M);
    driver.position.set(ck.x - ck.len * 0.2, ck.rim + ck.head, 0);
    if (L.helmetStripe) {
      const band = new T.Mesh(new T.TorusGeometry(0.137, 0.022, 8, 32), new T.MeshPhysicalMaterial({ color: L.helmetStripe, clearcoat: 1, roughness: 0.3 }));
      band.rotation.x = Math.PI / 2;
      band.position.y = 0.035;
      driver.add(band);
    }
    add("driver", driver);
    const sw = new T.Group();
    const swBody = box(0.06, 0.13, 0.27, M.carbon, 0.03);
    sw.add(swBody);
    const scr = new T.Mesh(new T.PlaneGeometry(0.1, 0.06), M.glow);
    scr.rotation.y = -Math.PI / 2;
    scr.position.x = -0.035;
    sw.add(scr);
    sw.rotation.z = 0.35;
    sw.position.set(ck.x + ck.len * 0.3, ck.rim + 0.01, 0);
    add("steering", sw);

    if (K.halo) {
      const g = new T.Group();
      const hx = ck.x - 0.02, hy = ck.rim + 0.2;
      const curve = new T.CatmullRomCurve3([
        new T.Vector3(hx - 0.32, ck.rim - 0.02, -0.25), new T.Vector3(hx - 0.2, hy, -0.27), new T.Vector3(hx + 0.18, hy + 0.01, -0.2),
        new T.Vector3(hx + 0.32, hy + 0.02, 0), new T.Vector3(hx + 0.18, hy + 0.01, 0.2), new T.Vector3(hx - 0.2, hy, 0.27), new T.Vector3(hx - 0.32, ck.rim - 0.02, 0.25),
      ]);
      g.add(new T.Mesh(new T.TubeGeometry(curve, 64, 0.026, 10), mat(L.halo, "carbon")));
      g.add(rod(new T.Vector3(hx + 0.32, hy + 0.02, 0), new T.Vector3(hx + 0.62, ck.rim - 0.02, 0), 0.024, mat(L.halo, "carbon")));
      add("halo", g);
    }

    for (const s of [-1, 1]) {
      const g = new T.Group();
      const sp0 = K.sidepods.stations[1];
      const mx = sp0.x + 0.05, mz = s * (K.sidepods.z + 0.02), my = sp0.top + 0.16;
      g.add(rod(new T.Vector3(mx - 0.06, sp0.top - 0.02, s * (K.sidepods.z - 0.06)), new T.Vector3(mx, my, mz), 0.01, M.carbon));
      g.add(rod(new T.Vector3(mx + 0.02, sp0.top - 0.02, s * (K.sidepods.z - 0.1)), new T.Vector3(mx, my - 0.01, mz - s * 0.03), 0.008, M.carbon));
      const pod = new T.Mesh(new T.SphereGeometry(1, 20, 12), mat(L.mirrors, "primary"));
      pod.scale.set(0.045, 0.05, 0.11);
      pod.position.set(mx, my, mz);
      g.add(pod);
      const face = new T.Mesh(new T.CircleGeometry(1, 16), M.mirror);
      face.scale.set(0.1, 0.042, 1);
      face.rotation.y = -Math.PI / 2;
      face.position.set(mx - 0.046, my, mz);
      g.add(face);
      const o = add("mirrors", g);
      o.userData.explodeSelf = new T.Vector3(0.1, 0.3, s * 0.5);
    }

    /* --- airbox, fin, camera --- */
    if (K.airbox) {
      const a = K.airbox;
      add("cover", new T.Mesh(loft(a.stations, { seg: 32 }), mat(L.cover, "primary")));
      const s0 = a.stations[0];
      const mouth = new T.Mesh(new T.CircleGeometry(1, 24), M.black);
      mouth.scale.set((s0.top - s0.bot) * 0.36, s0.w * 0.36, 1);
      mouth.rotation.set(0, Math.PI / 2, Math.PI / 2);
      mouth.position.set(s0.x + 0.005, (s0.top + s0.bot) / 2, 0);
      add("cover", mouth);
      if (K.fin) {
        const last = a.stations[a.stations.length - 1];
        add("cover", new T.Mesh(finGeometry(a.stations[1].x, K.rearWing.x + 0.05, a.stations[1].top - 0.05, a.stations[1].top + 0.01, last.top - 0.05, K.rearWing.y - 0.02, 0.012), mat(L.fin || L.cover, "primary")));
      }
      if (K.tcam) {
        const cam = box(0.16, 0.05, 0.05, mat(L.tcam, "accent"), 0.015);
        cam.position.set(s0.x - 0.1, s0.top + 0.035, 0);
        add("cover", cam);
      }
    }

    /* --- power unit, ERS, gearbox, exhaust --- */
    const E = K.engine;
    const eng = makeEngine(E.type, M, E.scale || 1);
    eng.position.set(E.x, E.y, 0);
    add("engine", eng);
    if (K.ers) {
      const g = new T.Group();
      const bat = box(0.5, 0.12, 0.42, M.carbon, 0.02);
      g.add(bat);
      for (let i = 0; i < 6; i++) {
        const cell = box(0.06, 0.02, 0.36, M.glow);
        cell.position.set(-0.2 + i * 0.08, 0.07, 0);
        g.add(cell);
      }
      const mgu = new T.Mesh(new T.CylinderGeometry(0.07, 0.07, 0.16, 18), M.accent);
      mgu.rotation.z = Math.PI / 2;
      mgu.position.set(0.0, 0.0, 0.3);
      g.add(mgu);
      g.position.set(ck.x - ck.len / 2 - 0.35, 0.2, 0);
      add("ers", g);
    }
    const ex = new T.Group();
    if (E.type.endsWith("T")) {
      const p = new T.Mesh(new T.CylinderGeometry(0.05, 0.055, 0.32, 16), M.darkMetal);
      p.rotation.z = Math.PI / 2 - 0.12;
      p.position.set(ra - 0.28, rR + 0.06, 0);
      ex.add(p);
      if (K.era < 2019) {
        for (const s of [-1, 1]) {
          const wg = new T.Mesh(new T.CylinderGeometry(0.02, 0.022, 0.2, 10), M.darkMetal);
          wg.rotation.z = Math.PI / 2 - 0.12;
          wg.position.set(ra - 0.24, rR + 0.15, s * 0.06);
          ex.add(wg);
        }
      }
    } else {
      for (const s of [-1, 1]) {
        const p = new T.Mesh(new T.CylinderGeometry(0.045, 0.05, 0.22, 14), M.darkMetal);
        p.position.set(E.x - 0.2, K.sidepods ? K.sidepods.stations[2].top + 0.04 : 0.6, s * 0.3);
        p.rotation.z = -0.5;
        ex.add(p);
      }
    }
    add("exhaust", ex);

    const gb = new T.Group();
    const gbox = box(0.62, 0.22, 0.28, M.darkMetal, 0.04);
    gbox.position.set(ra - 0.02, rR * 0.92, 0);
    gb.add(gbox);
    const crash = box(0.4, 0.14, 0.18, M.carbon, 0.04);
    crash.position.set(ra - 0.5, rR * 0.92, 0);
    gb.add(crash);
    const rain = box(0.03, 0.05, 0.1, M.rain, 0.01);
    rain.position.set(ra - 0.71, rR * 0.92, 0);
    gb.add(rain);
    add("gearbox", gb);

    /* --- wings --- */
    const FW = K.frontWing;
    {
      const g = new T.Group();
      let y = FW.y;
      FW.elements.forEach((el, i) => {
        const span = FW.span * (el.spanK || 1);
        const w = wingElement(el.chord, span, 0.1, el.aoa, i === 0 ? mat(L.fwMain, "carbon") : mat(L.fwFlaps, i === FW.elements.length - 1 ? "secondary" : "carbon"), 0.05);
        w.position.set(FW.x - (el.dx || 0), y + (el.dy || 0), 0);
        if (FW.swept) w.rotation.y = 0;
        w.userData.baseAoa = w.rotation.z;
        if (i > 0) flaps.push({ mesh: w, front: true });
        g.add(w);
        y += el.dy || 0;
      });
      for (const s of [-1, 1]) {
        const ep = box(FW.endplate.len, FW.endplate.h, 0.016, mat(L.endplates, "primary"), 0.02);
        ep.position.set(FW.x - FW.endplate.len / 2 + 0.08, FW.y + FW.endplate.h / 2 - 0.04, (s * FW.span) / 2);
        g.add(ep);
      }
      if (FW.pylons) {
        for (const s of [-1, 1]) {
          const py = box(0.26, FW.pylons, 0.014, M.carbon, 0.01);
          py.position.set(FW.x - 0.15, FW.y + FW.pylons / 2, s * 0.08);
          g.add(py);
        }
      }
      add("frontWing", g);
    }
    const RW = K.rearWing;
    {
      const g = new T.Group();
      let y = RW.y;
      RW.elements.forEach((el, i) => {
        const w = wingElement(el.chord, RW.span, 0.11, el.aoa, i === 0 ? mat(L.rwMain, "carbon") : mat(L.rwFlap, "primary"), 0.07);
        w.position.set(RW.x - (el.dx || 0), y + (el.dy || 0), 0);
        w.userData.baseAoa = w.rotation.z;
        if (i > 0) flaps.push({ mesh: w, front: false });
        g.add(w);
        y += el.dy || 0;
      });
      for (const s of [-1, 1]) {
        let ep;
        if (RW.roundEnd) {
          const sh = new T.Shape();
          const l = RW.endplate.len, h = RW.endplate.h;
          sh.moveTo(0, 0); sh.lineTo(-l, 0); sh.quadraticCurveTo(-l - 0.05, h * 0.7, -l * 0.6, h); sh.quadraticCurveTo(-0.05, h * 1.15, 0.06, h * 0.55); sh.lineTo(0, 0);
          const eg = new T.ExtrudeGeometry(sh, { depth: 0.016, bevelEnabled: false });
          eg.translate(0, 0, -0.008);
          ep = new T.Mesh(eg, mat(L.endplates, "primary"));
          ep.position.set(RW.x + 0.05, RW.y + RW.endplate.dy - RW.endplate.h / 2, (s * RW.span) / 2);
        } else {
          ep = box(RW.endplate.len, RW.endplate.h, 0.016, mat(L.endplates, "primary"), 0.02);
          ep.position.set(RW.x - RW.endplate.len / 2 + 0.05, RW.y + RW.endplate.dy, (s * RW.span) / 2);
        }
        g.add(ep);
      }
      const pylon = box(0.32, RW.y - rR * 0.9, 0.022, M.carbon, 0.01);
      pylon.position.set(RW.x - 0.22, (RW.y + rR * 0.9) / 2, 0);
      g.add(pylon);
      if (RW.beam) {
        const bw = wingElement(0.18, RW.span * 0.7, 0.12, 0.25, M.carbon);
        bw.position.set(ra - 0.4, rR * 1.28, 0);
        g.add(bw);
      }
      add("rearWing", g);
    }

    /* --- race number --- */
    if (L.number != null) {
      const tex = roundelTex(L.number, "none", L.numberColor || "#ffffff");
      const nm = new T.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -4 });
      const n = all.find((q) => q.x < B.noseSplit + 0.75) || all[1];
      const d = new T.Mesh(new T.PlaneGeometry(0.2, 0.2), nm);
      d.rotation.x = -Math.PI / 2;
      d.rotation.z = -Math.PI / 2;
      d.position.set(B.noseSplit + 0.55, (all.find((q) => q.x <= B.noseSplit + 0.55) || n).top + 0.012, 0);
      add("nose", d);
    }

    for (const k in parts) parts[k].userData.home.copy(parts[k].position);
    root.userData = { parts, wheels, flaps, kit: K, length: K.length };
    return root;
  }

  const EXPLODE = {
    frontWing: [1.7, -0.1, 0], nose: [1.15, 0.12, 0], chassis: [0, 0, 0], driver: [0.25, 1.3, 0], steering: [0.95, 1.05, 0],
    halo: [0.1, 1.85, 0], mirrors: [0.2, 0.25, 0], cover: [-0.45, 1.4, 0], engine: [-0.35, 0.8, 0], ers: [0.0, -0.55, 0],
    gearbox: [-1.05, 0.3, 0], rearWing: [-1.55, 1.05, 0], sidepods: [0, 0, 0], wheels: [0, 0, 0], suspension: [0, 0, 0],
    exhaust: [-0.75, 0.5, 0], bargeboards: [0, 0, 0], floor: [0, -1.0, 0],
  };

  /* ---------------- animation helpers ---------------- */
  function setExplode(car, t) {
    const { parts } = car.userData;
    const e = t * t * (3 - 2 * t);
    for (const k in parts) {
      const p = parts[k];
      p.position.copy(p.userData.home).addScaledVector(p.userData.explode, e);
      for (const c of p.children) {
        if (!c.userData.base) c.userData.base = c.position.clone();
        if (c.userData.explodeSelf) c.position.copy(c.userData.base).addScaledVector(c.userData.explodeSelf, e);
      }
    }
  }

  // Straight-line mode for active aero (2026): flaps flatten as t goes 0 -> 1.
  function setAero(car, t) {
    for (const f of car.userData.flaps) f.mesh.rotation.z = f.mesh.userData.baseAoa * (1 - 0.85 * t);
  }

  function spinWheels(car, angle) {
    for (const w of car.userData.wheels) w.rotation.z = w.rotation.y ? angle : -angle;
  }

  /* ---------------- kits: the seven regulation eras of the 21st century ---------------- */
  const s = (x, w, top, bot, e = 2.6, extra) => Object.assign({ x, w, top, bot, e }, extra || {});

  const V10 = {
    era: 2001, length: 4.55, wheelbase: 3.05, trackF: 1.46, trackR: 1.42, chassisW: 0.5, grooves: 4,
    tyreF: { r: 0.33, w: 0.27, side: 0.14 }, tyreR: { r: 0.33, w: 0.355, side: 0.14 }, wheelStyle: "disc",
    body: {
      noseSplit: 1.15, tailSplit: -0.42,
      stations: [s(2.55, 0.1, 0.45, 0.35, 2.4), s(2.25, 0.2, 0.52, 0.32, 2.6), s(1.15, 0.42, 0.66, 0.16, 3), s(0.3, 0.5, 0.74, 0.1, 3.2),
        s(-0.42, 0.56, 0.76, 0.1, 3.2), s(-1.2, 0.48, 0.66, 0.14, 3.4), s(-1.85, 0.16, 0.5, 0.26, 2.6)],
    },
    sidepods: { z: 0.44, stations: [s(0.5, 0.3, 0.52, 0.12, 5), s(0.2, 0.42, 0.56, 0.1, 5), s(-0.75, 0.36, 0.48, 0.1, 4.2), s(-1.35, 0.1, 0.3, 0.12, 3)] },
    cockpit: { x: 0.35, len: 0.75, w: 0.4, rim: 0.76, head: 0.12, mirrorZ: 0.4 },
    airbox: { stations: [s(-0.22, 0.26, 1.02, 0.8, 3), s(-0.42, 0.3, 1.04, 0.7, 3), s(-0.95, 0.28, 0.88, 0.62, 3), s(-1.55, 0.12, 0.64, 0.52, 2.6)] },
    engine: { type: "V10", x: -0.9, y: 0.36, scale: 0.85 },
    frontWing: { x: 2.55, y: 0.11, span: 1.38, pylons: 0.28, elements: [{ chord: 0.32, aoa: 0.05 }, { chord: 0.2, aoa: 0.32, dx: 0.28, dy: 0.05 }], endplate: { len: 0.46, h: 0.22 } },
    rearWing: { x: -2.05, y: 0.9, span: 1.0, elements: [{ chord: 0.36, aoa: 0.2 }, { chord: 0.24, aoa: 0.45, dx: 0.32, dy: 0.08 }, { chord: 0.13, aoa: 0.75, dx: 0.22, dy: 0.06 }], endplate: { len: 0.66, h: 0.48, dy: -0.03 }, beam: true },
    floor: { x: -0.1, y: 0.06, len: 2.7, w: 1.0 },
    bargeboards: true, tcam: true,
  };

  const KITS = {
    v10: V10,
    v8: merge(V10, { era: 2006, engine: { type: "V8", scale: 0.72 }, chimneys: true, horns: true, frontWing: { span: 1.4 } }),
    kers: merge(V10, {
      era: 2010, wheelbase: 3.15, length: 4.8, grooves: 0, ers: true, fin: true,
      tyreF: { r: 0.33, w: 0.245, side: 0.14 }, tyreR: { r: 0.33, w: 0.325, side: 0.14 },
      body: { stations: [s(2.6, 0.12, 0.5, 0.38, 2.4), s(2.3, 0.22, 0.58, 0.34, 2.6), s(1.15, 0.42, 0.66, 0.18, 3), s(0.3, 0.5, 0.74, 0.1, 3.2),
        s(-0.42, 0.54, 0.76, 0.1, 3.2), s(-1.2, 0.46, 0.64, 0.14, 3.4), s(-1.95, 0.14, 0.48, 0.26, 2.6)] },
      frontWing: { x: 2.65, y: 0.08, span: 1.8, pylons: 0.32, elements: [{ chord: 0.34, aoa: 0.04 }, { chord: 0.22, aoa: 0.3, dx: 0.3, dy: 0.05 }, { chord: 0.14, aoa: 0.55, dx: 0.18, dy: 0.05, spanK: 0.9 }], endplate: { len: 0.55, h: 0.26 } },
      rearWing: { x: -2.15, y: 0.98, span: 0.75, elements: [{ chord: 0.36, aoa: 0.18 }, { chord: 0.26, aoa: 0.45, dx: 0.32, dy: 0.1 }], endplate: { len: 0.66, h: 0.52, dy: -0.05 }, beam: true },
      floor: { len: 2.8 },
    }),
    hybrid: merge(V10, {
      era: 2014, wheelbase: 3.45, length: 5.05, grooves: 0, ers: true, fin: false,
      tyreF: { r: 0.33, w: 0.245, side: 0.14 }, tyreR: { r: 0.33, w: 0.325, side: 0.14 },
      body: { noseSplit: 1.3, stations: [s(2.85, 0.1, 0.24, 0.14, 2.4), s(2.5, 0.2, 0.36, 0.16, 2.6), s(1.3, 0.42, 0.62, 0.16, 3), s(0.35, 0.5, 0.72, 0.1, 3.2),
        s(-0.42, 0.54, 0.74, 0.1, 3.2), s(-1.25, 0.46, 0.62, 0.14, 3.4), s(-2.05, 0.14, 0.46, 0.26, 2.6)] },
      sidepods: { z: 0.44, stations: [s(0.55, 0.3, 0.56, 0.16, 5), s(0.3, 0.44, 0.6, 0.12, 5), s(-0.75, 0.34, 0.5, 0.1, 4), s(-1.5, 0.1, 0.3, 0.12, 3)] },
      engine: { type: "V6T", x: -0.95, y: 0.3, scale: 0.72 },
      frontWing: { x: 2.85, y: 0.08, span: 1.65, pylons: 0.14, elements: [{ chord: 0.34, aoa: 0.04 }, { chord: 0.22, aoa: 0.3, dx: 0.3, dy: 0.05 }, { chord: 0.15, aoa: 0.5, dx: 0.18, dy: 0.05, spanK: 0.92 }, { chord: 0.11, aoa: 0.7, dx: 0.12, dy: 0.04, spanK: 0.8 }], endplate: { len: 0.6, h: 0.28 } },
      rearWing: { x: -2.3, y: 0.98, span: 0.75, elements: [{ chord: 0.36, aoa: 0.18 }, { chord: 0.26, aoa: 0.45, dx: 0.32, dy: 0.1 }], endplate: { len: 0.7, h: 0.52, dy: -0.05 }, beam: false },
      floor: { len: 3.0 },
    }),
    wide: merge(V10, {
      era: 2017, wheelbase: 3.6, length: 5.5, trackF: 1.6, trackR: 1.55, grooves: 0, ers: true, fin: true,
      tyreF: { r: 0.33, w: 0.305, side: 0.14 }, tyreR: { r: 0.33, w: 0.405, side: 0.14 },
      body: { noseSplit: 1.35, tailSplit: -0.4, stations: [s(3.0, 0.1, 0.3, 0.18, 2.4), s(2.6, 0.22, 0.42, 0.18, 2.6), s(1.35, 0.42, 0.64, 0.14, 3), s(0.4, 0.5, 0.74, 0.1, 3.2),
        s(-0.4, 0.54, 0.76, 0.1, 3.2), s(-1.3, 0.46, 0.62, 0.14, 3.4), s(-2.15, 0.14, 0.46, 0.28, 2.6)] },
      sidepods: { z: 0.48, stations: [s(0.6, 0.26, 0.58, 0.2, 5), s(0.35, 0.46, 0.62, 0.12, 5), s(-0.6, 0.36, 0.5, 0.1, 4), s(-1.6, 0.1, 0.3, 0.12, 3)] },
      cockpit: { x: 0.45, mirrorZ: 0.46 },
      airbox: { stations: [s(-0.15, 0.26, 1.02, 0.8, 3), s(-0.35, 0.3, 1.04, 0.7, 3), s(-1.0, 0.26, 0.86, 0.62, 3), s(-1.75, 0.1, 0.62, 0.52, 2.6)] },
      engine: { type: "V6T", x: -1.0, y: 0.3, scale: 0.72 },
      frontWing: { x: 3.0, y: 0.08, span: 1.8, pylons: 0.2, elements: [{ chord: 0.36, aoa: 0.04 }, { chord: 0.22, aoa: 0.3, dx: 0.3, dy: 0.05 }, { chord: 0.16, aoa: 0.5, dx: 0.18, dy: 0.05, spanK: 0.9 }, { chord: 0.11, aoa: 0.72, dx: 0.12, dy: 0.04, spanK: 0.75 }], endplate: { len: 0.62, h: 0.28 } },
      rearWing: { x: -2.45, y: 0.86, span: 0.95, elements: [{ chord: 0.38, aoa: 0.18 }, { chord: 0.26, aoa: 0.45, dx: 0.32, dy: 0.1 }], endplate: { len: 0.72, h: 0.48, dy: -0.05 }, beam: true },
      floor: { len: 3.2, w: 1.4 },
    }),
    ge22: merge(V10, {
      era: 2022, wheelbase: 3.6, length: 5.6, trackF: 1.6, trackR: 1.55, grooves: 0, ers: true, fin: false, halo: true, covers: true, bargeboards: false,
      tyreF: { r: 0.36, w: 0.305, side: 0.1 }, tyreR: { r: 0.36, w: 0.405, side: 0.1 }, wheelStyle: "modern",
      body: { noseSplit: 1.4, tailSplit: -0.4, stations: [s(3.05, 0.12, 0.26, 0.15, 2.4), s(2.7, 0.24, 0.38, 0.15, 2.6), s(1.4, 0.42, 0.62, 0.14, 3), s(0.4, 0.52, 0.74, 0.1, 3.2),
        s(-0.4, 0.56, 0.78, 0.1, 3.2), s(-1.3, 0.48, 0.64, 0.14, 3.4), s(-2.2, 0.14, 0.48, 0.28, 2.6)] },
      sidepods: { z: 0.5, stations: [s(0.55, 0.22, 0.62, 0.36, 4), s(0.3, 0.44, 0.66, 0.24, 4.5), s(-0.5, 0.42, 0.58, 0.14, 4), s(-1.6, 0.12, 0.36, 0.16, 3)] },
      cockpit: { x: 0.45, mirrorZ: 0.5 },
      airbox: { stations: [s(-0.15, 0.24, 1.0, 0.8, 3), s(-0.35, 0.3, 1.02, 0.7, 3), s(-1.0, 0.28, 0.86, 0.62, 3), s(-1.85, 0.1, 0.6, 0.5, 2.6)] },
      engine: { type: "V6T", x: -1.0, y: 0.3, scale: 0.72 },
      frontWing: { x: 3.05, y: 0.08, span: 1.85, pylons: 0.14, elements: [{ chord: 0.38, aoa: 0.03 }, { chord: 0.24, aoa: 0.25, dx: 0.3, dy: 0.05 }, { chord: 0.18, aoa: 0.45, dx: 0.2, dy: 0.05 }, { chord: 0.13, aoa: 0.65, dx: 0.14, dy: 0.05 }], endplate: { len: 0.5, h: 0.17 } },
      rearWing: { x: -2.45, y: 0.94, span: 0.98, roundEnd: true, elements: [{ chord: 0.4, aoa: 0.16 }, { chord: 0.26, aoa: 0.42, dx: 0.34, dy: 0.09 }], endplate: { len: 0.7, h: 0.5, dy: -0.05 }, beam: true },
      floor: { len: 3.3, w: 1.6, fences: true },
    }),
    active26: merge(V10, {
      era: 2026, wheelbase: 3.4, length: 5.3, trackF: 1.56, trackR: 1.5, grooves: 0, ers: true, fin: false, halo: true, covers: true, bargeboards: false, active: true,
      tyreF: { r: 0.3525, w: 0.28, side: 0.095 }, tyreR: { r: 0.3525, w: 0.375, side: 0.095 }, wheelStyle: "modern",
      body: { noseSplit: 1.3, tailSplit: -0.4, stations: [s(2.9, 0.12, 0.27, 0.15, 2.4), s(2.55, 0.24, 0.38, 0.15, 2.6), s(1.3, 0.42, 0.62, 0.14, 3), s(0.38, 0.52, 0.74, 0.1, 3.2),
        s(-0.4, 0.56, 0.78, 0.1, 3.2), s(-1.25, 0.46, 0.64, 0.14, 3.4), s(-2.1, 0.14, 0.48, 0.28, 2.6)] },
      sidepods: { z: 0.47, stations: [s(0.5, 0.22, 0.62, 0.34, 4), s(0.28, 0.42, 0.66, 0.22, 4.5), s(-0.5, 0.38, 0.56, 0.14, 4), s(-1.55, 0.12, 0.34, 0.16, 3)] },
      cockpit: { x: 0.42, mirrorZ: 0.48 },
      airbox: { stations: [s(-0.16, 0.24, 1.0, 0.8, 3), s(-0.36, 0.3, 1.02, 0.7, 3), s(-0.98, 0.26, 0.84, 0.62, 3), s(-1.8, 0.1, 0.6, 0.5, 2.6)] },
      engine: { type: "V6T", x: -0.98, y: 0.3, scale: 0.72 },
      frontWing: { x: 2.9, y: 0.09, span: 1.75, pylons: 0.14, elements: [{ chord: 0.36, aoa: 0.03 }, { chord: 0.24, aoa: 0.28, dx: 0.3, dy: 0.05 }, { chord: 0.16, aoa: 0.5, dx: 0.2, dy: 0.05 }], endplate: { len: 0.5, h: 0.17 } },
      rearWing: { x: -2.3, y: 0.94, span: 0.95, roundEnd: true, elements: [{ chord: 0.38, aoa: 0.16 }, { chord: 0.24, aoa: 0.42, dx: 0.32, dy: 0.09 }, { chord: 0.14, aoa: 0.65, dx: 0.2, dy: 0.06 }], endplate: { len: 0.7, h: 0.52, dy: -0.05 }, beam: false },
      floor: { len: 3.1, w: 1.5, fences: true },
    }),
  };

  window.PWCar = { buildCar, setExplode, setAero, spinWheels, KITS, loft };
})();
