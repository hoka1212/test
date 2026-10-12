/* Shared three.js stage: renderer, bright studio lighting, soft ground shadow,
   touch/mouse orbit, and a render loop that sleeps while the canvas is off screen. */
(function () {
  "use strict";
  const T = THREE;

  // A small daylight "room" baked into a PMREM environment for glossy paint reflections.
  function studioEnvironment(renderer, tint = 0xeaf2fb) {
    const scene = new T.Scene();
    const room = new T.Mesh(new T.BoxGeometry(30, 14, 30), new T.MeshBasicMaterial({ color: tint, side: T.BackSide }));
    room.position.y = 6;
    scene.add(room);
    const panel = (w, h, x, y, z, ry, intensity, color = 0xffffff) => {
      const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: new T.Color(color).multiplyScalar(intensity), side: T.DoubleSide }));
      m.position.set(x, y, z);
      m.rotation.y = ry;
      m.lookAt(0, 1, 0);
      scene.add(m);
    };
    panel(16, 3, 0, 12.8, 0, 0, 6);          // big softbox above
    panel(10, 4, -12, 5, 4, 0, 3.2);         // key side
    panel(10, 4, 12, 5, -6, 0, 2.2, 0xdde9ff); // cool fill
    panel(8, 2, 0, 3, 13, 0, 1.6);           // front strip
    const floor = new T.Mesh(new T.PlaneGeometry(30, 30), new T.MeshBasicMaterial({ color: 0xc9d3de }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.5;
    scene.add(floor);
    const pm = new T.PMREMGenerator(renderer);
    const env = pm.fromScene(scene, 0.04).texture;
    pm.dispose();
    return env;
  }

  function shadowTexture() {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    const grd = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    grd.addColorStop(0, "rgba(20,30,50,0.55)");
    grd.addColorStop(0.55, "rgba(20,30,50,0.2)");
    grd.addColorStop(1, "rgba(20,30,50,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    return new T.CanvasTexture(c);
  }

  function createStage(container, opts = {}) {
    const canvas = document.createElement("canvas");
    canvas.className = "stage-canvas";
    container.appendChild(canvas);
    const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.maxDpr || 1.75));
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = opts.exposure || 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;

    const scene = new T.Scene();
    scene.environment = studioEnvironment(renderer, opts.envTint);
    if (opts.fog) scene.fog = new T.Fog(opts.fog.color, opts.fog.near, opts.fog.far);

    const camera = new T.PerspectiveCamera(opts.fov || 32, 1, 0.05, 400);
    camera.position.set(6, 2.6, 6);

    const hemi = new T.HemisphereLight(0xffffff, 0xb8c6d6, 0.9);
    scene.add(hemi);
    const sun = new T.DirectionalLight(0xffffff, 2.2);
    sun.position.set(4, 9, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -5; sun.shadow.camera.right = 5;
    sun.shadow.camera.top = 5; sun.shadow.camera.bottom = -5;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 25;
    sun.shadow.bias = -0.0005;
    sun.shadow.radius = 4;
    scene.add(sun);

    if (opts.ground !== false) {
      const ground = new T.Mesh(new T.PlaneGeometry(60, 60), new T.ShadowMaterial({ opacity: 0.16 }));
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      scene.add(ground);
      const blob = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }));
      blob.rotation.x = -Math.PI / 2;
      blob.position.y = 0.002;
      blob.scale.set(6.4, 2.8, 1);
      scene.add(blob);
      stageApi_blob = blob;
    }

    let visible = true;
    let running = true;
    const tickers = new Set();
    const clock = new T.Clock();

    function resize() {
      const w = container.clientWidth || 1, h = container.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    const io = new IntersectionObserver((entries) => { visible = entries[0].isIntersecting; }, { rootMargin: "120px" });
    io.observe(container);

    function loop() {
      if (!running) return;
      requestAnimationFrame(loop);
      const dt = Math.min(clock.getDelta(), 0.05);
      if (!visible) return;
      for (const f of tickers) f(dt, clock.elapsedTime);
      renderer.render(scene, camera);
    }
    requestAnimationFrame(loop);

    const api = {
      renderer, scene, camera, canvas, sun, blob: stageApi_blob,
      onTick(f) { tickers.add(f); return () => tickers.delete(f); },
      renderOnce() { renderer.render(scene, camera); },
      dispose() { running = false; ro.disconnect(); io.disconnect(); renderer.dispose(); },
    };
    stageApi_blob = null;
    return api;
  }
  let stageApi_blob = null;

  /* Orbit control written for touch first: one-finger drag rotates, pinch or wheel zooms. */
  function orbit(stage, target, opts = {}) {
    const el = stage.canvas;
    const st = { theta: opts.theta ?? 0.9, phi: opts.phi ?? 1.18, r: opts.r ?? 8, tTheta: opts.theta ?? 0.9, tPhi: opts.phi ?? 1.18, tR: opts.r ?? 8,
      minR: opts.minR ?? 3.5, maxR: opts.maxR ?? 16, auto: opts.auto ?? 0.12, idle: 0, target: target.clone() };
    const pointers = new Map();
    let pinch0 = 0, r0 = 0, moved = 0;
    el.style.touchAction = "pan-y";
    el.addEventListener("pointerdown", (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = 0;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch0 = Math.hypot(a.x - b.x, a.y - b.y); r0 = st.tR;
      }
      el.setPointerCapture?.(e.pointerId);
    });
    el.addEventListener("pointermove", (e) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      if (pointers.size === 1) {
        st.tTheta -= dx * 0.008;
        st.tPhi = Math.min(1.5, Math.max(0.35, st.tPhi - dy * 0.006));
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch0) st.tR = Math.min(st.maxR, Math.max(st.minR, (r0 * pinch0) / d));
      }
      st.idle = 0;
    });
    const up = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch0 = 0; };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("wheel", (e) => {
      if (!opts.wheel) return;
      e.preventDefault();
      st.tR = Math.min(st.maxR, Math.max(st.minR, st.tR * (1 + e.deltaY * 0.001)));
      st.idle = 0;
    }, { passive: false });
    stage.onTick((dt) => {
      st.idle += dt;
      if (st.auto && st.idle > 2.5 && !pointers.size) st.tTheta += dt * st.auto;
      const k = 1 - Math.pow(0.0015, dt);
      st.theta += (st.tTheta - st.theta) * k;
      st.phi += (st.tPhi - st.phi) * k;
      st.r += (st.tR - st.r) * k;
      const c = stage.camera;
      c.position.set(
        st.target.x + st.r * Math.sin(st.phi) * Math.cos(st.theta),
        st.target.y + st.r * Math.cos(st.phi),
        st.target.z + st.r * Math.sin(st.phi) * Math.sin(st.theta)
      );
      c.lookAt(st.target);
    });
    return { state: st, wasDrag: () => moved > 8 };
  }

  window.PWStage = { createStage, orbit };
})();
