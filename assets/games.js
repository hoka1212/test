(function () {
  "use strict";

  const { CIRCUITS, BY_ID, flag, REDUCED, latestLayout, SEASON } = window.PitWall;
  const $ = (sel) => document.querySelector(sel);
  const store = {
    get(k) { try { return localStorage.getItem("pitwall:" + k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem("pitwall:" + k, v); } catch (e) { /* storage unavailable */ } },
  };
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const fmtSec = (ms) => (ms / 1000).toFixed(3);
  const fmtSeasons = (s) => s.replace(/-/g, "–").replace(/,/g, ", ");

  /* =================== Lights Out =================== */
  (function lightsOut() {
    const pad = $("#lights-pad");
    const pods = Array.from(pad.querySelectorAll(".pod"));
    const readout = $("#lights-time");
    const status = $("#lights-status");
    const bestEl = $("#lights-best");
    let state = "idle";
    let timers = [];
    let t0 = 0;
    let best = parseFloat(store.get("lights-best")) || null;

    const showBest = () => { bestEl.textContent = best ? fmtSec(best) : "—"; };
    const clear = () => { timers.forEach(clearTimeout); timers = []; };
    const setLights = (n) => pods.forEach((p, i) => p.classList.toggle("on", i < n));

    function start() {
      clear();
      state = "arming";
      readout.className = "lights-readout";
      readout.textContent = "0.000";
      status.textContent = "Жди, пока погаснут все огни";
      setLights(0);
      for (let i = 1; i <= 5; i++) timers.push(setTimeout(() => setLights(i), i * 900));
      const hold = 5 * 900 + 400 + Math.random() * 2600;
      timers.push(setTimeout(() => { state = "hold"; }, 5 * 900));
      timers.push(setTimeout(() => {
        setLights(0);
        state = "go";
        t0 = performance.now();
      }, hold));
    }

    function verdict(ms) {
      if (ms < 100) return "Подозрительно быстро. Похоже на угаданный старт";
      if (ms < 200) return "Уровень пилота Формулы 1";
      if (ms < 260) return "Отличная реакция, можно на поул";
      if (ms < 350) return "Неплохо, но соперник уже впереди";
      return "Проспал старт. Попробуй ещё раз";
    }

    function press() {
      if (state === "idle" || state === "done") return start();
      if (state === "arming" || state === "hold") {
        clear();
        setLights(0);
        state = "done";
        readout.className = "lights-readout is-bad";
        readout.textContent = "ФАЛЬСТАРТ";
        status.textContent = "Штраф: проезд по пит-лейн. Нажми, чтобы попробовать снова";
        return;
      }
      if (state === "go") {
        const ms = performance.now() - t0;
        state = "done";
        readout.className = "lights-readout is-good";
        readout.textContent = fmtSec(ms);
        const record = !best || ms < best;
        if (record && ms >= 100) {
          best = ms;
          store.set("lights-best", String(ms));
          showBest();
        }
        status.textContent = verdict(ms) + (record && ms >= 100 ? ". Новый рекорд!" : "");
      }
    }

    pad.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      press();
    });
    // Keyboard (Space / Enter) produces a click with detail 0.
    pad.addEventListener("click", (e) => { if (e.detail === 0) press(); });
    showBest();
  })();

  /* =================== Призрачный круг (Ghost Lap) =================== */
  (function ghostLap() {
    const ROUNDS = 10;
    const DRAW_MS = 6000;
    const PHANTOM_LAP_MS = 4200;

    const modeButtons = Array.from(document.querySelectorAll("#ghost-modes [data-mode]"));
    const full = $("#ghost-full");
    const trace = $("#ghost-trace");
    const reveal = $("#ghost-reveal");
    const options = $("#ghost-options");
    const hintBtn = $("#ghost-hint");
    const nextBtn = $("#ghost-next");
    const progress = $("#ghost-progress");
    const scoreEl = $("#ghost-score");
    const bestEl = $("#ghost-best");
    $("#ghost-year").textContent = SEASON.year;

    const calendarIds = Array.from(new Set(SEASON.races.map((r) => r.circuit))).filter((id) => BY_ID[id]);

    let mode = store.get("ghost-mode") || "season";
    if (!modeButtons.some((b) => b.dataset.mode === mode)) mode = "season";
    let run = null;
    let frame = 0;

    function poolFor(m) {
      return m === "season" ? calendarIds.map((id) => BY_ID[id]) : CIRCUITS;
    }

    function layoutFor(c, m) {
      return m === "season" ? latestLayout(c) : pick(c.layouts);
    }

    function setMode(m) {
      mode = m;
      store.set("ghost-mode", m);
      modeButtons.forEach((b) => b.setAttribute("aria-checked", String(b.dataset.mode === m)));
      showBest();
    }

    function showBest() {
      const v = store.get("ghost-best-" + mode);
      bestEl.textContent = v ? `${v} очков` : "—";
    }

    function setPath(d) {
      full.setAttribute("d", d);
      trace.setAttribute("d", d);
    }

    function stopAnim() { cancelAnimationFrame(frame); }

    function animateDraw(onDone) {
      const len = trace.getTotalLength();
      const t0 = performance.now();
      trace.style.strokeDasharray = `${len} ${len}`;
      if (REDUCED) {
        trace.style.strokeDashoffset = "0";
        return;
      }
      const step = (now) => {
        const k = Math.min(1, (now - t0) / DRAW_MS);
        trace.style.strokeDashoffset = String(len * (1 - k));
        if (k < 1) frame = requestAnimationFrame(step);
        else if (onDone) onDone();
      };
      frame = requestAnimationFrame(step);
    }

    function animatePhantom() {
      const len = trace.getTotalLength();
      const tail = len * 0.12;
      trace.style.strokeDasharray = `${tail} ${len - tail}`;
      const t0 = performance.now();
      const step = (now) => {
        const k = ((now - t0) % PHANTOM_LAP_MS) / PHANTOM_LAP_MS;
        trace.style.strokeDashoffset = String(tail - k * len);
        frame = requestAnimationFrame(step);
      };
      if (REDUCED) {
        // Without motion the phantom shows a few fixed fragments of the lap.
        trace.style.strokeDasharray = `${len * 0.06} ${len * 0.19}`;
        trace.style.strokeDashoffset = "0";
        return;
      }
      frame = requestAnimationFrame(step);
    }

    function idleScreen() {
      stopAnim();
      const demo = BY_ID.monaco ? latestLayout(BY_ID.monaco) : CIRCUITS[0].layouts[0];
      setPath(demo.d);
      full.classList.add("is-shown");
      trace.style.strokeDasharray = "none";
      trace.style.strokeDashoffset = "0";
      trace.style.opacity = "0";
      reveal.innerHTML = "<b>10 кругов, 4 варианта ответа</b>Чем быстрее узнаешь трассу, тем больше очков. Подсказка 50/50 убирает два неверных ответа, но делит очки пополам.";
      options.textContent = "";
      progress.textContent = `Круг 0 из ${ROUNDS}`;
      scoreEl.textContent = "0 очков";
      hintBtn.disabled = true;
      nextBtn.textContent = "Начать заезд";
      modeButtons.forEach((b) => { b.disabled = false; });
    }

    function startRun() {
      const pool = poolFor(mode);
      const picks = shuffle(pool).slice(0, Math.min(ROUNDS, pool.length));
      run = { pool, picks, i: -1, score: 0, correct: 0, answered: true };
      modeButtons.forEach((b) => { b.disabled = true; });
      nextQuestion();
    }

    function nextQuestion() {
      stopAnim();
      run.i += 1;
      if (run.i >= run.picks.length) return finish();
      const c = run.picks[run.i];
      const layout = layoutFor(c, mode);
      const decoys = shuffle(run.pool.filter((x) => x.id !== c.id)).slice(0, 3);
      run.q = { c, layout, choices: shuffle([c, ...decoys]), t0: performance.now(), hint: false };
      run.answered = false;

      setPath(layout.d);
      full.classList.remove("is-shown");
      trace.style.opacity = "1";
      if (mode === "phantom") animatePhantom();
      else animateDraw();

      progress.textContent = `Круг ${run.i + 1} из ${run.picks.length}`;
      scoreEl.textContent = `${run.score} очков`;
      reveal.textContent = mode === "phantom" ? "Следи за призраком. Какая это трасса?" : "Какая это трасса?";
      hintBtn.disabled = false;
      nextBtn.hidden = true;

      options.textContent = "";
      for (const ch of run.q.choices) {
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.id = ch.id;
        const name = document.createElement("b");
        name.textContent = ch.name;
        const sub = document.createElement("small");
        sub.textContent = `${flag(ch.cc)} ${ch.city}, ${ch.country}`;
        b.append(name, sub);
        b.addEventListener("click", () => answer(ch.id));
        options.append(b);
      }
      options.querySelector("button").focus({ preventScroll: true });
    }

    function useHint() {
      if (!run || run.answered || run.q.hint) return;
      run.q.hint = true;
      hintBtn.disabled = true;
      const wrong = shuffle(run.q.choices.filter((c) => c.id !== run.q.c.id)).slice(0, 2);
      wrong.forEach((w) => {
        const b = options.querySelector(`[data-id="${w.id}"]`);
        if (b) b.disabled = true;
        if (b) b.style.visibility = "hidden";
      });
    }

    function answer(id) {
      if (!run || run.answered) return;
      run.answered = true;
      stopAnim();
      const q = run.q;
      const ok = id === q.c.id;
      const elapsed = performance.now() - q.t0;
      let pts = 0;
      if (ok) {
        pts = Math.max(100, Math.round(1000 - elapsed / 12));
        if (q.hint) pts = Math.round(pts / 2);
        run.score += pts;
        run.correct += 1;
      }
      options.querySelectorAll("button").forEach((b) => {
        b.disabled = true;
        if (b.dataset.id === q.c.id) b.classList.add("is-right");
        else if (b.dataset.id === id) b.classList.add("is-wrong");
      });
      full.classList.add("is-shown");
      trace.style.opacity = "0";
      const c = q.c;
      reveal.innerHTML = "";
      const head = document.createElement("b");
      head.className = ok ? "ok" : "bad";
      head.textContent = ok ? `Верно! +${pts} за ${(elapsed / 1000).toFixed(1)} с` : "Мимо";
      const body = document.createElement("span");
      body.textContent = `${flag(c.cc)} ${c.official}, ${c.city}. Эта конфигурация: ${fmtSeasons(q.layout.seasons)}.`;
      reveal.append(head, body);
      scoreEl.textContent = `${run.score} очков`;
      hintBtn.disabled = true;
      nextBtn.hidden = false;
      nextBtn.textContent = run.i + 1 >= run.picks.length ? "Финиш" : "Следующий круг";
      nextBtn.focus({ preventScroll: true });
    }

    function finish() {
      stopAnim();
      const prev = parseInt(store.get("ghost-best-" + mode), 10) || 0;
      const record = run.score > prev;
      if (record) store.set("ghost-best-" + mode, String(run.score));
      showBest();
      reveal.innerHTML = "";
      const head = document.createElement("b");
      head.textContent = `Финиш: ${run.score} очков`;
      const body = document.createElement("span");
      body.textContent = `Угадано ${run.correct} из ${run.picks.length}.` + (record ? " Новый рекорд режима!" : "");
      reveal.append(head, body);
      options.textContent = "";
      progress.textContent = `Круг ${run.picks.length} из ${run.picks.length}`;
      nextBtn.hidden = false;
      nextBtn.textContent = "Ещё заезд";
      modeButtons.forEach((b) => { b.disabled = false; });
      run = null;
    }

    modeButtons.forEach((b) => b.addEventListener("click", () => {
      if (run) return;
      setMode(b.dataset.mode);
    }));
    hintBtn.textContent = "Подсказка 50/50";
    hintBtn.addEventListener("click", useHint);
    nextBtn.addEventListener("click", () => {
      if (!run) startRun();
      else if (run.answered) nextQuestion();
    });

    setMode(mode);
    idleScreen();
  })();
})();
