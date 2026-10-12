(function () {
  "use strict";

  const CIRCUITS = window.F1_CIRCUITS || [];
  const SEASON = window.F1_SEASON;
  const BY_ID = Object.fromEntries(CIRCUITS.map((c) => [c.id, c]));
  const API = "https://api.jolpi.ca/ergast/f1/";
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const SVG_NS = "http://www.w3.org/2000/svg";

  const TEAM_COLORS = {
    mercedes: "#00a19b", ferrari: "#e8002d", mclaren: "#ff8000", red_bull: "#3671c6",
    rb: "#6692ff", alpine: "#ff87bc", haas: "#9aa0a6", audi: "#8a8f98", sauber: "#52e252",
    williams: "#1868db", aston_martin: "#229971", cadillac: "#b8952d",
  };
  const TEAM_NAMES = {
    mercedes: "Mercedes", ferrari: "Ferrari", mclaren: "McLaren", red_bull: "Red Bull",
    rb: "Racing Bulls", alpine: "Alpine", haas: "Haas", audi: "Audi", sauber: "Sauber",
    williams: "Williams", aston_martin: "Aston Martin", cadillac: "Cadillac",
  };
  const teamColor = (id) => TEAM_COLORS[id] || "#9aa2d6";
  const teamName = (id) => TEAM_NAMES[id] || id;

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const flag = (cc) => cc.replace(/./g, (ch) => String.fromCodePoint(127397 + ch.charCodeAt(0)));
  const fmtPts = (p) => (Number.isInteger(p) ? String(p) : p.toFixed(1)).replace(".", ",");
  const pad = (n) => String(n).padStart(2, "0");

  function trackSvg(d, cls) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "-20 -20 540 540");
    if (cls) svg.setAttribute("class", cls);
    svg.setAttribute("aria-hidden", "true");
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    p.setAttribute("pathLength", "1");
    svg.appendChild(p);
    return svg;
  }
  const latestLayout = (c) => c.layouts[c.layouts.length - 1];

  // Shared helpers for games.js
  window.PitWall = { CIRCUITS, BY_ID, flag, REDUCED, latestLayout, SEASON, nextRace: () => nextRace() };

  /* ---------- Season state ---------- */
  function nextRace() {
    const now = Date.now();
    return SEASON.races.find((r) => new Date(r.start).getTime() + 2 * 3600e3 > now) || null;
  }

  /* ---------- Hero ---------- */
  let heroTimer = 0;
  function renderHero() {
    const race = nextRace();
    const last = SEASON.races[SEASON.races.length - 1];
    const r = race || last;
    const c = BY_ID[r.circuit];
    $("#hero-round").textContent = race
      ? `Этап ${r.round} из ${SEASON.races.length} · следующий старт`
      : `Сезон ${SEASON.year} завершён`;
    $("#hero-title").textContent = r.name;
    $("#hero-place").textContent = c ? `${c.name}, ${c.city} ${flag(c.cc)}` : "";
    const start = new Date(r.start);
    $("#hero-start").textContent = "Старт гонки: " + start.toLocaleString("ru-RU", {
      weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
    }) + " по твоему времени";

    clearInterval(heroTimer);
    const tick = () => {
      let ms = Math.max(0, start.getTime() - Date.now());
      const d = Math.floor(ms / 864e5); ms -= d * 864e5;
      const h = Math.floor(ms / 36e5); ms -= h * 36e5;
      const m = Math.floor(ms / 6e4); ms -= m * 6e4;
      const s = Math.floor(ms / 1e3);
      $("#cd-d").textContent = pad(d);
      $("#cd-h").textContent = pad(h);
      $("#cd-m").textContent = pad(m);
      $("#cd-s").textContent = pad(s);
    };
    tick();
    heroTimer = setInterval(tick, 1000);
  }

  /* ---------- Calendar ---------- */
  function renderCalendar() {
    $("#season-year").textContent = SEASON.year;
    const done = SEASON.races.filter((r) => r.winner).length;
    $("#season-note").textContent = `${done} из ${SEASON.races.length} гонок позади`;
    const next = nextRace();
    const codes = Object.fromEntries(SEASON.drivers.map((d) => [d.code, d]));
    const list = $("#calendar");
    list.textContent = "";
    for (const r of SEASON.races) {
      const c = BY_ID[r.circuit];
      const li = el("li", "race");
      if (r.winner) li.classList.add("is-done");
      if (next && next.round === r.round) li.classList.add("is-next");
      const top = el("div", "race-top");
      top.append(el("span", null, `Этап ${r.round}`));
      if (r.winner) {
        const w = el("span", "race-winner", r.winner);
        const drv = codes[r.winner];
        if (drv) {
          w.style.setProperty("--team", teamColor(drv.team));
          w.title = `Победитель: ${drv.first} ${drv.last}`;
        }
        top.append(w);
      } else if (next && next.round === r.round) {
        top.append(el("span", null, "Следующая"));
      }
      li.append(top);
      if (c) li.append(trackSvg(latestLayout(c).d));
      li.append(el("span", "race-name", r.name));
      const date = new Date(r.start).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
      li.append(el("span", "race-meta", c ? `${date} · ${c.name}` : date));
      list.append(li);
    }
  }

  /* ---------- Standings ---------- */
  let duelA = null;
  let duelB = null;

  function renderStandings() {
    const dl = $("#driver-list");
    dl.textContent = "";
    const maxPts = Math.max(1, ...SEASON.drivers.map((d) => d.points));
    for (const d of SEASON.drivers) {
      const li = el("li");
      const b = el("button", "driver-row");
      b.type = "button";
      b.dataset.code = d.code;
      b.style.setProperty("--team", teamColor(d.team));
      b.style.setProperty("--k", String(d.points / maxPts));
      b.append(el("span", "pos", d.pos));
      b.append(el("span", "stripe"));
      const who = el("span", "who");
      who.append(el("b", null, `${d.first} ${d.last}`));
      who.append(el("span", null, `${teamName(d.team)}${d.wins ? ` · побед: ${d.wins}` : ""}`));
      b.append(who);
      b.append(el("span", "pts", fmtPts(d.points)));
      b.append(el("span", "bar"));
      b.setAttribute("aria-label", `${d.pos}. ${d.first} ${d.last}, ${fmtPts(d.points)} очков. Добавить в дуэль`);
      b.addEventListener("click", () => {
        if (d.code === duelA || d.code === duelB) return;
        duelB = duelA;
        duelA = d.code;
        syncDuel();
        $("#duel").scrollIntoView({ behavior: REDUCED ? "auto" : "smooth" });
      });
      li.append(b);
      dl.append(li);
    }

    const tl = $("#team-list");
    tl.textContent = "";
    const maxT = Math.max(1, ...SEASON.teams.map((t) => t.points));
    for (const t of SEASON.teams) {
      const li = el("li", "team-row");
      li.style.setProperty("--team", teamColor(t.id));
      li.style.setProperty("--w", `${Math.max(1.5, (t.points / maxT) * 100)}%`);
      const top = el("div", "team-row-top");
      top.append(el("b", null, `${t.pos}. ${teamName(t.id)}`));
      top.append(el("span", null, fmtPts(t.points)));
      const bar = el("div", "team-bar");
      bar.append(el("i"));
      li.append(top, bar);
      tl.append(li);
    }
  }

  /* ---------- Duel ---------- */
  function fillSelect(sel, value) {
    sel.textContent = "";
    for (const d of SEASON.drivers) {
      const o = el("option", null, `${d.first} ${d.last} (${d.code})`);
      o.value = d.code;
      sel.append(o);
    }
    sel.value = value;
  }

  function pickDefaults() {
    const [first, ...rest] = SEASON.drivers;
    duelA = first.code;
    const rival = rest.find((d) => d.team !== first.team) || rest[0];
    duelB = rival.code;
  }

  function holoCard(node, d) {
    node.style.setProperty("--team", teamColor(d.team));
    node.textContent = "";
    const top = el("div");
    top.append(el("div", "holo-num", d.number || d.code));
    const bottom = el("div");
    bottom.append(el("div", "holo-code", d.code));
    const name = el("div", "holo-name");
    name.append(document.createTextNode(d.first));
    name.append(el("b", null, d.last));
    bottom.append(name);
    bottom.append(el("div", "holo-team", `${teamName(d.team)} · P${d.pos}`));
    node.append(top, bottom);
    node.setAttribute("aria-label", `${d.first} ${d.last}, ${teamName(d.team)}`);
  }

  function attachTilt(node) {
    if (REDUCED) return;
    const reset = () => {
      node.classList.remove("is-tilting");
      node.style.setProperty("--rx", "0deg");
      node.style.setProperty("--ry", "0deg");
      node.style.setProperty("--mx", "50%");
      node.style.setProperty("--my", "50%");
    };
    node.addEventListener("pointermove", (e) => {
      const r = node.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      node.classList.add("is-tilting");
      node.style.setProperty("--ry", `${(x - 0.5) * 22}deg`);
      node.style.setProperty("--rx", `${(0.5 - y) * 22}deg`);
      node.style.setProperty("--mx", `${x * 100}%`);
      node.style.setProperty("--my", `${y * 100}%`);
    });
    node.addEventListener("pointerleave", reset);
    node.addEventListener("pointercancel", reset);
    node.addEventListener("pointerup", (e) => { if (e.pointerType !== "mouse") reset(); });
  }

  function syncDuel() {
    const byCode = Object.fromEntries(SEASON.drivers.map((d) => [d.code, d]));
    const a = byCode[duelA];
    const b = byCode[duelB];
    if (!a || !b) return;
    $("#duel-a").value = duelA;
    $("#duel-b").value = duelB;
    holoCard($("#holo-a"), a);
    holoCard($("#holo-b"), b);
    document.querySelectorAll(".driver-row").forEach((row) => {
      row.classList.toggle("is-picked", row.dataset.code === duelA || row.dataset.code === duelB);
    });

    const best = (x, y, lowerWins) => (x === y ? 0 : (lowerWins ? x < y : x > y) ? -1 : 1);
    const rows = [
      ["Позиция", `P${a.pos}`, `P${b.pos}`, best(a.pos, b.pos, true)],
      ["Очки", fmtPts(a.points), fmtPts(b.points), best(a.points, b.points)],
      ["Победы", a.wins, b.wins, best(a.wins, b.wins)],
      ["Очков за этап", fmtPts(+(a.points / Math.max(1, SEASON.round)).toFixed(1)), fmtPts(+(b.points / Math.max(1, SEASON.round)).toFixed(1)), best(a.points, b.points)],
      ["Разрыв", a.points >= b.points ? "—" : fmtPts(b.points - a.points), b.points >= a.points ? "—" : fmtPts(a.points - b.points), 0],
    ];
    const stats = $("#duel-stats");
    stats.textContent = "";
    for (const [label, va, vb, lead] of rows) {
      const row = el("div");
      const ddA = el("dd", lead === -1 ? "lead" : "", va);
      const ddB = el("dd", lead === 1 ? "lead" : "", vb);
      row.append(ddA, el("dt", null, label), ddB);
      stats.append(row);
    }
    drawChart(a, b);
  }

  function drawChart(a, b) {
    const svg = $("#duel-chart");
    svg.textContent = "";
    const n = Math.max(a.progression.length, b.progression.length);
    const W = 760, H = 300, L = 44, R = 64, T = 16, B = 34;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    if (!n) return;
    const series = [a, b].map((d) => {
      let last = 0;
      return d.progression.map((v) => (last = v == null ? last : v));
    });
    const max = Math.max(10, ...series.flat());
    const step = max > 300 ? 100 : max > 120 ? 50 : 25;
    const top = Math.ceil(max / step) * step;
    const x = (i) => L + (n === 1 ? 0 : (i / (n - 1)) * (W - L - R));
    const y = (v) => T + (1 - v / top) * (H - T - B);
    const mk = (tag, attrs, text) => {
      const node = document.createElementNS(SVG_NS, tag);
      for (const k in attrs) node.setAttribute(k, attrs[k]);
      if (text != null) node.textContent = text;
      svg.appendChild(node);
      return node;
    };
    const axis = document.createElementNS(SVG_NS, "g");
    axis.setAttribute("class", "axis");
    svg.appendChild(axis);
    for (let v = 0; v <= top; v += step) {
      mk("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: "gridline" });
      const t = mk("text", { x: L - 8, y: y(v) + 4, "text-anchor": "end" }, v);
      axis.appendChild(t);
    }
    for (let i = 0; i < n; i++) {
      if (n > 12 && i % 2 === 1 && i !== n - 1) continue;
      const t = mk("text", { x: x(i), y: H - 10, "text-anchor": "middle" }, i + 1);
      axis.appendChild(t);
    }
    const sameTeam = a.team === b.team;
    [a, b].forEach((d, k) => {
      const pts = series[k].map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
      const color = teamColor(d.team);
      const line = mk("polyline", { points: pts, class: "line", stroke: color });
      if (sameTeam && k === 1) line.setAttribute("stroke-dasharray", "7 6");
      const lastV = series[k][series[k].length - 1];
      mk("circle", { cx: x(series[k].length - 1), cy: y(lastV), r: 5, fill: color });
      const ly = y(lastV) + 4 + (k === 1 && Math.abs(y(series[0][series[0].length - 1]) - y(lastV)) < 14 ? 14 : 0);
      mk("text", { x: x(series[k].length - 1) + 10, y: ly, class: "end-label", fill: color }, d.code);
    });
  }

  function initDuel() {
    pickDefaults();
    fillSelect($("#duel-a"), duelA);
    fillSelect($("#duel-b"), duelB);
    $("#duel-a").addEventListener("change", (e) => {
      duelA = e.target.value;
      if (duelA === duelB) duelB = SEASON.drivers.find((d) => d.code !== duelA).code;
      syncDuel();
    });
    $("#duel-b").addEventListener("change", (e) => {
      duelB = e.target.value;
      if (duelA === duelB) duelA = SEASON.drivers.find((d) => d.code !== duelB).code;
      syncDuel();
    });
    attachTilt($("#holo-a"));
    attachTilt($("#holo-b"));
    syncDuel();
  }

  function renderStamp(live) {
    $("#data-stamp").textContent = `Данные сезона ${SEASON.year} после этапа ${SEASON.round}` +
      (live ? ", обновлено только что." : ".");
  }

  function renderAll(live) {
    renderHero();
    renderCalendar();
    renderStandings();
    if (!duelA) initDuel(); else syncDuel();
    renderStamp(live);
  }

  /* ---------- Live refresh from the Jolpica API (silently keeps the built-in snapshot if offline) ---------- */
  async function refresh() {
    try {
      const get = async (p) => {
        const res = await fetch(API + p, { cache: "no-store" });
        if (!res.ok) throw new Error(res.status);
        return (await res.json()).MRData;
      };
      const year = SEASON.year;
      const [ds, cs, wins] = await Promise.all([
        get(`${year}/driverstandings/?limit=100`),
        get(`${year}/constructorstandings/?limit=100`),
        get(`${year}/results/1/?limit=100`),
      ]);
      const list = ds.StandingsTable.StandingsLists[0];
      if (!list || +list.round <= SEASON.round) return;
      const round = +list.round;
      const prev = Object.fromEntries(SEASON.drivers.map((d) => [d.code, d]));
      SEASON.drivers = list.DriverStandings.map((s) => {
        const code = s.Driver.code;
        const old = prev[code];
        const progression = old ? old.progression.slice() : Array(SEASON.round).fill(null);
        while (progression.length < round - 1) progression.push(progression[progression.length - 1] ?? null);
        progression.push(+s.points);
        return {
          code, first: s.Driver.givenName, last: s.Driver.familyName,
          number: s.Driver.permanentNumber, team: s.Constructors[s.Constructors.length - 1].constructorId,
          points: +s.points, wins: +s.wins, pos: +s.position, progression,
        };
      });
      SEASON.teams = cs.StandingsTable.StandingsLists[0].ConstructorStandings.map((t) => ({
        id: t.Constructor.constructorId, name: t.Constructor.name,
        points: +t.points, wins: +t.wins, pos: +t.position,
      }));
      const winners = Object.fromEntries(wins.RaceTable.Races.map((r) => [+r.round, r.Results[0].Driver.code]));
      SEASON.races.forEach((r) => { r.winner = winners[r.round] || r.winner; });
      SEASON.round = round;
      renderAll(true);
    } catch (e) {
      /* offline or blocked: the built-in snapshot stays on screen */
    }
  }

  renderAll(false);
  refresh();
})();
