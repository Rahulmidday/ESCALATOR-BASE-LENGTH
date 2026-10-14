"use strict";

/* =====================================================================
   1. CORE CALCULATION
   A line-for-line port of the C program:
     - height in mm, must be a positive number
     - angle must be 30 or 35 degrees
     - angleRad   = angle * PI / 180.0
     - baseLength = height / tan(angleRad)
   ===================================================================== */
/* ===== CORE-START ===== */
const PI = 3.14159265358979323846;

function calculateBaseLength(height, angle) {
  // Step 1: Input floor height (in mm)
  if (typeof height !== "number" || !isFinite(height) || height <= 0) {
    return { ok: false, message: "Invalid height. Please enter a positive number." };
  }

  // Step 2: Input inclination angle (only 30 or 35 allowed)
  if (angle !== 30 && angle !== 35) {
    return { ok: false, message: "Invalid angle. Only 30 or 35 degrees are allowed." };
  }

  // Step 3: Convert degrees to radians
  const angleRad = angle * PI / 180.0;

  // Step 4: Calculate base length
  const baseLength = height / Math.tan(angleRad);

  // Step 5: Return the result for output
  return { ok: true, height, angle, angleRad, tanValue: Math.tan(angleRad), baseLength };
}
/* ===== CORE-END ===== */


/* =====================================================================
   2. HELPERS
   ===================================================================== */
const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r2 = (v) => Math.round(v * 100) / 100;
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const KEY = { theme: "blt-esc-theme", unit: "blt-esc-unit", log: "blt-esc-log" };
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } }
};

const UNITS = {
  mm: { factor: 1,     dp: 2, hintDp: 0, labelDp: 0, label: "mm" },
  m:  { factor: 1000,  dp: 3, hintDp: 0, labelDp: 2, label: "m" },
  ft: { factor: 304.8, dp: 3, hintDp: 1, labelDp: 2, label: "ft" }
};
const nf = (v, dp) => v.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const fromMm = (mm, u) => mm / UNITS[u].factor;
const fmt = (mm, u, dp) => nf(fromMm(mm, u), dp === undefined ? UNITS[u].dp : dp);
const fmtU = (mm, u, dp) => fmt(mm, u, dp) + " " + UNITS[u].label;
const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };
const setAttrs = (node, attrs) => { for (const k in attrs) node.setAttribute(k, attrs[k]); };
const pts = (list) => list.map((p) => r2(p[0]) + "," + r2(p[1])).join(" ");


/* =====================================================================
   3. DRAWING CONSTANTS (millimetres unless noted)
   ===================================================================== */
const VBW = 800, VBH = 600, YB = 440;                 // drawing width and lower-floor line (px)
const S0 = 0.072, MAXH = 290, MAXW = 560;   // px per mm, and the fit limits in px
const RISER = 210;                          // step riser
const TRUSS_D = 1000, BAND = 420;           // truss depth, step band depth
const HAND_H = 1000, END_EXT = 900, CURVE = 380;
const SLIDER_MIN = 2000, SLIDER_MAX = 12000;


/* =====================================================================
   4. STATE AND DOM
   ===================================================================== */
const state = {
  unit: "mm",
  heightMm: 4000,
  angle: 30,
  valid: true,
  result: null,
  target: { h: 4000, a: 30 },
  cur: { h: 4000, a: 30 },      // tweened values the drawing and readouts use
  playing: !REDUCED,
  dir: 1,
  speed: 0.5,                   // m/s
  phase: 0,                     // unbounded step travel, in steps
  railPx: 0,
  rider: { c0: 0 },
  s: S0,
  fs: 22,
  hk: 1,                       // handle size factor, larger on small screens
  log: []
};
let dirty = true, lastT = performance.now(), announceTimer = 0, flashTimer = 0;

const dom = {};
[
  "stage", "floorRef", "lowerSlab", "upperSlab", "scaleFig", "truss", "bandPoly", "stepBody", "treads", "skirt",
  "rider", "glass", "rail", "railSheen", "angleSector", "angleText", "extLA", "extLB", "dimLLine", "dimLPlate",
  "dimHLine", "dimHPlate", "ptA", "ptB",
  "height", "heightRange", "heightHint", "heightError", "unitTag", "baseValue", "baseUnit", "fInc", "fSteps",
  "c30row", "c35row", "c30bar", "c35bar", "c30val", "c35val", "resultPanel", "copyBtn", "saveBtn", "actionStatus",
  "s1", "s2", "s3", "s4", "s5", "logList", "logEmpty", "clearLog", "playBtn", "playLabel", "themeBtn", "liveRegion",
  "tip", "tipTitle", "tipBody", "handle"
].forEach((id) => { dom[id] = $(id); });
const factRows = Array.prototype.slice.call(document.querySelectorAll(".facts [data-u]"));


/* =====================================================================
   5. THEME
   ===================================================================== */
function currentTheme() {
  return document.documentElement.getAttribute("data-theme") ||
    (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}
function applyTheme(name, persist) {
  document.documentElement.setAttribute("data-theme", name);
  dom.themeBtn.setAttribute("aria-pressed", String(name === "dark"));
  if (persist) store.set(KEY.theme, name);
}
dom.themeBtn.addEventListener("click", () => applyTheme(currentTheme() === "dark" ? "light" : "dark", true));
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
  if (!store.get(KEY.theme)) applyTheme(e.matches ? "dark" : "light", false);
});


/* =====================================================================
   6. INPUTS
   ===================================================================== */
function trimNum(x, dp) { return String(+x.toFixed(dp)); }

function writeHeightField() {
  dom.height.value = trimNum(fromMm(state.heightMm, state.unit), UNITS[state.unit].dp);
}

function syncRange() {
  dom.heightRange.value = state.heightMm;
  const pct = clamp((state.heightMm - SLIDER_MIN) / (SLIDER_MAX - SLIDER_MIN), 0, 1) * 100;
  dom.heightRange.style.setProperty("--fill", pct + "%");
  const txt = fmtU(state.heightMm, state.unit, UNITS[state.unit].labelDp);
  dom.heightRange.setAttribute("aria-valuetext", txt);
  setAttrs(dom.handle, { "aria-valuemin": SLIDER_MIN, "aria-valuemax": SLIDER_MAX, "aria-valuenow": Math.round(state.heightMm), "aria-valuetext": txt });
}

function updateHint() {
  const u = state.unit, dp = UNITS[u].hintDp;
  const span = fmt(SLIDER_MIN, u, dp) + " to " + fmt(SLIDER_MAX, u, dp) + " " + UNITS[u].label;
  const outside = state.heightMm < SLIDER_MIN || state.heightMm > SLIDER_MAX;
  setText(dom.heightHint, outside
    ? "Outside the slider range of " + span + ". The result is still exact."
    : "Floor to floor. The slider covers " + span + ".");
}

function showError(message) {
  dom.heightError.textContent = message;
  dom.heightError.hidden = false;
  dom.height.setAttribute("aria-invalid", "true");
  dom.resultPanel.classList.add("stale");
  dom.copyBtn.disabled = true;
  dom.saveBtn.disabled = true;
  state.valid = false;
}
function clearError() {
  dom.heightError.hidden = true;
  dom.height.removeAttribute("aria-invalid");
  dom.resultPanel.classList.remove("stale");
  dom.copyBtn.disabled = false;
  dom.saveBtn.disabled = false;
  state.valid = true;
}

/* Run the core calculation and push the result to the page. */
function commit() {
  const res = calculateBaseLength(state.heightMm, state.angle);
  if (!res.ok) { showError(res.message); return; }
  clearError();
  state.result = res;
  state.target.h = res.height;
  state.target.a = res.angle;

  setText(dom.s1, nf(res.height, 2) + " mm");
  setText(dom.s2, res.angle + "° (only 30° or 35° are accepted)");
  setText(dom.s3, res.angle + " × π ÷ 180 = " + res.angleRad.toFixed(6) + " rad");
  setText(dom.s4, "tan(" + res.angle + "°) = " + res.tanValue.toFixed(6));
  setText(dom.s5, nf(res.height, 2) + " ÷ " + res.tanValue.toFixed(6) + " = " + nf(res.baseLength, 2) + " mm");

  updateHint();
  syncRange();
  announceSoon();
  dirty = true;
}

dom.height.addEventListener("input", () => {
  const raw = dom.height.value.trim();
  if (raw === "") { showError("Enter a floor height to see the base length."); return; }
  const mm = parseFloat(raw) * UNITS[state.unit].factor;
  const res = calculateBaseLength(mm, state.angle);
  if (!res.ok) { showError(res.message); return; }
  state.heightMm = mm;
  commit();
});

dom.heightRange.addEventListener("input", () => {
  state.heightMm = Number(dom.heightRange.value);
  writeHeightField();
  commit();
});

document.querySelectorAll('input[name="angle"]').forEach((r) => {
  r.addEventListener("change", () => { state.angle = Number(r.value); commit(); });
});

document.querySelectorAll('input[name="unit"]').forEach((r) => {
  r.addEventListener("change", () => setUnit(r.value, true));
});

function setUnit(u, persist) {
  if (!UNITS[u]) return;
  state.unit = u;
  if (persist) store.set(KEY.unit, u);
  setText(dom.unitTag, UNITS[u].label);
  setText(dom.baseUnit, UNITS[u].label);
  if (state.valid) writeHeightField();
  else { clearError(); writeHeightField(); }
  updateHint();
  syncRange();
  renderLog();
  announceSoon();
  dirty = true;
}


/* =====================================================================
   7. STAGE CONTROLS
   ===================================================================== */
dom.playBtn.addEventListener("click", () => {
  state.playing = !state.playing;
  dom.playBtn.classList.toggle("is-paused", !state.playing);
  setText(dom.playLabel, state.playing ? "Pause" : "Play");
});
document.querySelectorAll('input[name="dir"]').forEach((r) => {
  r.addEventListener("change", () => { state.dir = Number(r.value); });
});
document.querySelectorAll('input[name="speed"]').forEach((r) => {
  r.addEventListener("change", () => { state.speed = Number(r.value); });
});


/* =====================================================================
   8. READOUTS (follow the tweened values so numbers count with the drawing)
   ===================================================================== */
function renderReadouts() {
  const h = state.cur.h, a = state.cur.a, u = state.unit;
  const rad = a * PI / 180.0;
  const base = h / Math.tan(rad);
  const incline = h / Math.sin(rad);

  setText(dom.baseValue, fmt(base, u));
  factRows.forEach((row) => {
    const ru = row.getAttribute("data-u");
    row.hidden = ru === u;
    setText(row.querySelector("dd"), fmtU(base, ru));
  });
  setText(dom.fInc, fmtU(incline, u));
  setText(dom.fSteps, String(Math.round(h / RISER)));

  const b30 = h / Math.tan(30 * PI / 180.0);
  const b35 = h / Math.tan(35 * PI / 180.0);
  setText(dom.c30val, fmtU(b30, u));
  setText(dom.c35val, fmtU(b35, u));
  dom.c30bar.style.width = "100%";
  dom.c35bar.style.width = (b35 / b30 * 100).toFixed(1) + "%";
  dom.c30row.classList.toggle("on", state.angle === 30);
  dom.c35row.classList.toggle("on", state.angle === 35);
  dom.c30row.setAttribute("aria-pressed", String(state.angle === 30));
  dom.c35row.setAttribute("aria-pressed", String(state.angle === 35));
}


/* =====================================================================
   9. DRAWING
   ===================================================================== */
function plate(g, cx, cy, text, rot) {
  const rect = g.querySelector("rect"), t = g.querySelector("text");
  setText(t, text);
  const w = text.length * state.fs * 0.5 + state.fs * 1.2;
  const hgt = state.fs * 1.6;
  setAttrs(rect, { x: r2(-w / 2), y: r2(-hgt / 2), width: r2(w), height: r2(hgt), rx: 6 });
  g.setAttribute("transform", "translate(" + r2(cx) + " " + r2(cy) + ") rotate(" + rot + ")");
}

function draw() {
  const h = state.cur.h, a = state.cur.a, u = state.unit;
  const th = a * PI / 180.0;
  const tanT = Math.tan(th), sinT = Math.sin(th), cosT = Math.cos(th);
  const L = h / tanT;

  // Scale: a fixed size for short rises, shrinking only when the drawing would not fit.
  const s = Math.min(S0, MAXW / L, MAXH / h);
  state.s = s;
  const Lp = L * s, Hp = h * s;
  const x0 = (VBW - Lp) / 2 - 30, x1 = x0 + Lp;
  const yB = YB, yT = YB - Hp;
  const e = END_EXT * s, D = TRUSS_D * s, Ds = BAND * s, hr = HAND_H * s, cv = CURVE * s;
  const xH = x1 + e + 46, yL = yB + 96;

  // Floors and reference line
  setAttrs(dom.lowerSlab, { x: -10, y: yB, width: r2(Math.max(0, x0 - e + 10)), height: 16 });
  setAttrs(dom.upperSlab, { x: r2(x1 + e), y: r2(yT), width: r2(VBW + 10 - (x1 + e)), height: 16 });
  setAttrs(dom.floorRef, { x1: r2(x1), y1: yB, x2: r2(xH + 8), y2: yB });

  // Truss and the band the moving steps are clipped to
  dom.truss.setAttribute("points", pts([
    [x0 - e, yB], [x0, yB], [x1, yT], [x1 + e, yT],
    [x1 + e, yT + D], [x1, yT + D], [x0, yB + D], [x0 - e, yB + D]
  ]));
  dom.bandPoly.setAttribute("points", pts([[x0, yB], [x1, yT], [x1, yT + Ds], [x0, yB + Ds]]));

  // Steps: a sawtooth whose corners sit on the incline; sliding it one period looks identical
  const d = (RISER / tanT) * s, rp = RISER * s;
  const f = state.phase - Math.floor(state.phase);
  const k0 = -2, k1 = Math.ceil(Lp / d) + 2;
  const sx = x0 + (k0 + f) * d, sy = yB - (k0 + f) * rp;
  const body = ["M" + r2(sx) + " " + r2(sy)], tr = [];
  for (let k = k0; k <= k1; k++) {
    const vx = x0 + (k + f) * d, vy = yB - (k + f) * rp;
    tr.push("M" + r2(vx) + " " + r2(vy) + "H" + r2(vx + d));
    body.push("H" + r2(vx + d) + "V" + r2(vy - rp));
  }
  const ex = x0 + (k1 + 1 + f) * d, ey = yB - (k1 + 1 + f) * rp;
  body.push("L" + r2(ex) + " " + r2(ey + Ds * 1.6) + "L" + r2(sx) + " " + r2(sy + Ds * 1.6) + "Z");
  dom.stepBody.setAttribute("d", body.join(""));
  dom.treads.setAttribute("d", tr.join(""));
  dom.treads.setAttribute("stroke-width", r2(clamp(rp * 0.22, 1.2, 3.4)));
  setAttrs(dom.skirt, { x1: r2(x0), y1: r2(yB), x2: r2(x1), y2: r2(yT) });

  // Balustrade glass and handrail
  const TL = [x0 + cv * cosT, yB - hr - cv * sinT];
  const TR = [x1 - cv * cosT, yT - hr + cv * sinT];
  dom.glass.setAttribute("points", pts([[TL[0], TL[1] + hr], TL, TR, [TR[0], TR[1] + hr]]));
  const railD =
    "M" + r2(x0 - e * 0.9) + " " + r2(yB - hr) +
    "L" + r2(x0 - cv) + " " + r2(yB - hr) +
    "Q" + r2(x0) + " " + r2(yB - hr) + " " + r2(TL[0]) + " " + r2(TL[1]) +
    "L" + r2(TR[0]) + " " + r2(TR[1]) +
    "Q" + r2(x1) + " " + r2(yT - hr) + " " + r2(x1 + cv) + " " + r2(yT - hr) +
    "L" + r2(x1 + e * 0.9) + " " + r2(yT - hr);
  dom.rail.setAttribute("d", railD);
  dom.railSheen.setAttribute("d", railD);
  dom.railSheen.style.strokeDashoffset = String(-state.railPx);

  // Passengers: one standing at the lower landing for scale, one riding
  const fx = Math.max(26, (x0 - e) / 2);
  dom.scaleFig.setAttribute("transform", "translate(" + r2(fx) + " " + yB + ") scale(" + s.toFixed(5) + ")");
  const n = h / RISER;
  const cr = state.phase + state.rider.c0;
  const stand = clamp(cr, 0, n);
  const rx = x0 + (cr + 0.5) * d, ry = yB - stand * rp;
  dom.rider.setAttribute("transform", "translate(" + r2(rx) + " " + r2(ry) + ") scale(" + s.toFixed(5) + ")");
  dom.rider.setAttribute("opacity", (clamp(cr + 1, 0, 1) * clamp(n + 1 - cr, 0, 1)).toFixed(2));

  // Angle marker at the lower end
  const R = Math.min(64, Lp * 0.28);
  dom.angleSector.setAttribute("d",
    "M" + r2(x0) + " " + r2(yB) + "L" + r2(x0 + R) + " " + r2(yB) +
    "A" + r2(R) + " " + r2(R) + " 0 0 0 " + r2(x0 + R * cosT) + " " + r2(yB - R * sinT) + "Z");
  setAttrs(dom.angleText, { x: r2(x0 - 12), y: r2(yB - state.fs * 0.85) });
  setText(dom.angleText, +a.toFixed(1) + "°");

  // Dimension: base length (horizontal)
  const labelDp = UNITS[u].labelDp;
  setAttrs(dom.extLA, { x1: r2(x0), y1: r2(yB + D + 6), x2: r2(x0), y2: yL + 12 });
  setAttrs(dom.extLB, { x1: r2(x1), y1: r2(yT + D + 6), x2: r2(x1), y2: yL + 12 });
  setAttrs(dom.dimLLine, { x1: r2(x0), y1: yL, x2: r2(x1), y2: yL });
  plate(dom.dimLPlate, (x0 + x1) / 2, yL, fmtU(L, u, labelDp), 0);

  // Dimension: floor height (vertical)
  setAttrs(dom.dimHLine, { x1: r2(xH), y1: r2(yT), x2: r2(xH), y2: yB });
  plate(dom.dimHPlate, xH, (yT + yB) / 2, fmtU(h, u, labelDp), -90);

  setAttrs(dom.ptA, { cx: r2(x0), cy: yB });
  setAttrs(dom.ptB, { cx: r2(x1), cy: r2(yT) });
  dom.handle.setAttribute("transform", "translate(" + r2(x1) + " " + r2(yT) + ") scale(" + state.hk.toFixed(3) + ")");
}


/* =====================================================================
   10. ANIMATION LOOP
   ===================================================================== */
function advance(dt) {
  const th = state.cur.a * PI / 180.0;
  const pitchMm = RISER / Math.sin(th);                       // one step along the incline
  state.phase += state.dir * (state.speed * 1000 * dt) / pitchMm;
  state.railPx += state.dir * state.speed * 1000 * dt * state.s;

  // Send the passenger back to the start once they leave the far end
  const n = state.cur.h / RISER;
  const cr = state.phase + state.rider.c0;
  if (state.dir > 0 && cr > n + 1) state.rider.c0 = -Math.floor(state.phase) - 1;
  else if (state.dir < 0 && cr < -1) state.rider.c0 = Math.floor(n) + 1 - Math.floor(state.phase);
}

function frame(now) {
  const dt = Math.min(0.05, Math.max(0, (now - lastT) / 1000));
  lastT = now;

  const c = state.cur, t = state.target;
  const k = REDUCED ? 1 : 1 - Math.exp(-dt * 6.5);
  let tweened = false;
  if (c.h !== t.h) {
    c.h += (t.h - c.h) * k;
    if (Math.abs(t.h - c.h) < 0.02) c.h = t.h;
    tweened = true;
  }
  if (c.a !== t.a) {
    c.a += (t.a - c.a) * k;
    if (Math.abs(t.a - c.a) < 0.0005) c.a = t.a;
    tweened = true;
  }
  if (state.playing) advance(dt);

  if (hoverKey) renderTip();
  if (tweened || dirty) renderReadouts();
  if (tweened || dirty || state.playing) draw();
  dirty = false;
  requestAnimationFrame(frame);
}

function updateFs() {
  const w = dom.stage.getBoundingClientRect().width || VBW;
  state.fs = clamp(15 / (w / VBW), 20, 40);
  state.hk = clamp(12 / (w / VBW) / 13, 1, 2.2);
  dom.stage.style.setProperty("--fs", state.fs.toFixed(1) + "px");
  dirty = true;
}
if (typeof ResizeObserver !== "undefined") new ResizeObserver(updateFs).observe(dom.stage);
window.addEventListener("resize", updateFs);


/* =====================================================================
   11. ACTIONS: copy, save, log, screen-reader announcements
   ===================================================================== */
function flash(message) {
  dom.actionStatus.textContent = message;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { dom.actionStatus.textContent = ""; }, 3500);
}

function announceSoon() {
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => {
    const r = state.result;
    if (!r) return;
    const msg = "Base length " + fmtU(r.baseLength, state.unit) + " for a floor height of " +
      fmtU(r.height, state.unit) + " at " + r.angle + " degrees.";
    dom.liveRegion.textContent = msg;
    dom.stage.setAttribute("aria-label", "Side view of an escalator. " + msg);
  }, 500);
}

dom.copyBtn.addEventListener("click", async () => {
  if (!state.valid || !state.result) return;
  const r = state.result, u = state.unit;
  const text = "Escalator base length: " + fmtU(r.baseLength, u) +
    " (floor height " + fmtU(r.height, u) + ", incline " + r.angle + "°)";
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; }
  catch (e) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", "");
      ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      ok = document.execCommand("copy");
      document.body.removeChild(ta);
    } catch (e2) { ok = false; }
  }
  flash(ok ? "Copied to the clipboard." : "Copying is blocked here. Select the number and copy it by hand.");
});

function loadLog() {
  try {
    const raw = JSON.parse(store.get(KEY.log) || "[]");
    if (Array.isArray(raw)) {
      state.log = raw.filter((i) => i && isFinite(i.h) && isFinite(i.b) && (i.a === 30 || i.a === 35)).slice(0, 20);
    }
  } catch (e) { state.log = []; }
}
function saveLog() { store.set(KEY.log, JSON.stringify(state.log)); }

function renderLog() {
  dom.logList.textContent = "";
  state.log.forEach((item) => {
    const li = document.createElement("li");
    const box = document.createElement("div");
    const main = document.createElement("span");
    const meta = document.createElement("span");
    main.className = "main"; meta.className = "meta";
    main.textContent = fmtU(item.b, state.unit);
    meta.textContent = fmtU(item.h, state.unit) + " at " + item.a + "°";
    box.appendChild(main); box.appendChild(meta);
    const del = document.createElement("button");
    del.type = "button"; del.textContent = "×";
    del.setAttribute("aria-label", "Remove " + main.textContent + " from the log");
    del.addEventListener("click", () => {
      state.log = state.log.filter((i) => i.id !== item.id);
      saveLog(); renderLog();
    });
    li.appendChild(box); li.appendChild(del);
    dom.logList.appendChild(li);
  });
  dom.logEmpty.hidden = state.log.length > 0;
  dom.clearLog.hidden = state.log.length === 0;
}

dom.saveBtn.addEventListener("click", () => {
  if (!state.valid || !state.result) return;
  const r = state.result, top = state.log[0];
  if (top && top.h === r.height && top.a === r.angle) { flash("Already at the top of the log."); return; }
  state.log.unshift({ id: Date.now() + Math.random(), h: r.height, a: r.angle, b: r.baseLength });
  state.log = state.log.slice(0, 20);
  saveLog(); renderLog();
  flash("Saved to the log.");
});
dom.clearLog.addEventListener("click", () => { state.log = []; saveLog(); renderLog(); });


/* =====================================================================
   11b. DRAWING INTERACTION
   Hover or tap for details, drag the round handle to set the height,
   select the angle marker (or a comparison row) to switch the incline.
   None of this touches calculateBaseLength.
   ===================================================================== */
const TIP_ORDER = ["handle", "angle", "base", "height", "person", "rail", "steps", "glass", "truss", "lowfloor", "upfloor"];
const drag = { active: false, id: null, y: 0, h: 0 };
let hoverKey = null, tipTimer = 0, suppressClick = false;

function setHeightFromUI(mm) {
  state.heightMm = clamp(Math.round(mm / 10) * 10, SLIDER_MIN, SLIDER_MAX);
  writeHeightField();
  commit();
}

function setAngle(a) {
  if (a !== 30 && a !== 35) return;
  state.angle = a;
  const radio = document.getElementById(a === 30 ? "a30" : "a35");
  if (radio) radio.checked = true;
  commit();
}

/* Light up a part of the drawing together with its matching panel. */
function setHot(key, on) {
  document.querySelectorAll('[data-tip="' + key + '"], [data-link="' + key + '"]').forEach((n) => n.classList.toggle("hot", on));
}

/* The part under the pointer; the handle and angle win over parts drawn beneath them. */
function pickAt(x, y) {
  let best = null, rank = 99;
  document.elementsFromPoint(x, y).forEach((n) => {
    const t = n.closest ? n.closest("[data-tip]") : null;
    if (!t || !dom.stage.contains(t)) return;
    const r = TIP_ORDER.indexOf(t.getAttribute("data-tip"));
    if (r !== -1 && r < rank) { best = t; rank = r; }
  });
  return best;
}

function tipContent(key) {
  const u = state.unit, dp = UNITS[u].labelDp;
  const r = state.result;
  const h = r ? r.height : state.cur.h, a = r ? r.angle : state.cur.a;
  const th = a * PI / 180.0;
  const base = h / Math.tan(th), inc = h / Math.sin(th);
  switch (key) {
    case "handle":   return ["Floor height", fmtU(h, u, dp) + ". Drag up or down to change it, or use the arrow keys."];
    case "angle":    return ["Incline angle", a + "°. Select it to switch to " + (a === 30 ? 35 : 30) + "°."];
    case "base":     return ["Base length", fmtU(base, u, dp) + ". The floor height divided by tan(" + a + "°)."];
    case "height":   return ["Floor height", fmtU(h, u, dp) + " from the lower floor to the upper floor."];
    case "truss":    return ["Truss", "The steel frame under the steps. Along the slope it measures " + fmtU(inc, u, dp) + "."];
    case "steps":    return ["Steps", "About " + Math.round(h / RISER) + " steps at a " + RISER + " mm riser, moving at " + state.speed.toFixed(2) + " m/s."];
    case "rail":     return ["Handrail", "Moves at the same speed as the steps."];
    case "glass":    return ["Balustrade", "The glass panel between the steps and the handrail."];
    case "person":   return ["Passenger", "Drawn 1.7 m tall, so you can judge the size."];
    case "lowfloor": return ["Lower floor", "Where passengers step on."];
    case "upfloor":  return ["Upper floor", fmtU(h, u, dp) + " above the lower floor."];
    default:         return ["", ""];
  }
}

function renderTip() {
  if (!hoverKey) return;
  const c = tipContent(hoverKey);
  setText(dom.tipTitle, c[0]);
  setText(dom.tipBody, c[1]);
}

/* Place the tooltip near a point (client coordinates), kept inside the drawing. */
function placeTip(cx, cy) {
  const wrap = dom.tip.parentNode.getBoundingClientRect();
  dom.tip.hidden = false;
  const w = dom.tip.offsetWidth, hgt = dom.tip.offsetHeight;
  let x = cx - wrap.left + 14, y = cy - wrap.top + 18;
  if (x + w > wrap.width - 8) x = cx - wrap.left - w - 14;
  if (y + hgt > wrap.height - 8) y = cy - wrap.top - hgt - 14;
  x = clamp(x, 8, Math.max(8, wrap.width - w - 8));
  y = clamp(y, 8, Math.max(8, wrap.height - hgt - 8));
  dom.tip.style.transform = "translate(" + Math.round(x) + "px, " + Math.round(y) + "px)";
}

function hover(el, cx, cy) {
  const key = el ? el.getAttribute("data-tip") : null;
  if (key !== hoverKey) {
    if (hoverKey) setHot(hoverKey, false);
    hoverKey = key;
    if (key) setHot(key, true);
  }
  if (key) { renderTip(); placeTip(cx, cy); }
  else dom.tip.hidden = true;
}

function hoverByFocus(el) {
  const b = el.getBoundingClientRect();
  hover(el, b.left + b.width / 2, b.top + b.height / 2);
}

function svgY(e) {
  const r = dom.stage.getBoundingClientRect();
  return (e.clientY - r.top) * (VBH / r.height);
}

/* Hover (mouse) and tap (touch) */
dom.stage.addEventListener("pointermove", (e) => {
  if (drag.active || e.pointerType === "touch") return;
  hover(pickAt(e.clientX, e.clientY), e.clientX, e.clientY);
});
dom.stage.addEventListener("pointerleave", (e) => {
  if (!drag.active && e.pointerType !== "touch") hover(null);
});
dom.stage.addEventListener("pointerdown", (e) => {
  if (drag.active) return;
  hover(pickAt(e.clientX, e.clientY), e.clientX, e.clientY);
  if (e.pointerType === "touch") {
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => hover(null), 3500);
  }
});
dom.stage.addEventListener("click", (e) => {
  if (suppressClick) return;
  const el = pickAt(e.clientX, e.clientY);
  if (el && el.getAttribute("data-tip") === "angle") setAngle(state.angle === 30 ? 35 : 30);
});

/* Drag the handle. Each move changes the height by the pointer's travel divided by the
   drawing scale, so the handle stays under the pointer while the drawing is at full size
   and the height keeps changing smoothly once the drawing starts to shrink to fit. */
dom.handle.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
dom.handle.addEventListener("pointerdown", (e) => {
  if (e.button !== undefined && e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  drag.active = true;
  drag.id = e.pointerId;
  drag.y = svgY(e);
  drag.h = state.heightMm;
  try { dom.handle.setPointerCapture(e.pointerId); } catch (err) { /* capture unavailable */ }
  dom.stage.classList.add("is-dragging");
  clearTimeout(tipTimer);
  hover(dom.handle, e.clientX, e.clientY);
});
dom.handle.addEventListener("pointermove", (e) => {
  if (!drag.active || e.pointerId !== drag.id) return;
  const y = svgY(e);
  drag.h = clamp(drag.h + (drag.y - y) / state.s, SLIDER_MIN, SLIDER_MAX);
  drag.y = y;
  setHeightFromUI(drag.h);
  placeTip(e.clientX, e.clientY);
});
function endDrag(e) {
  if (!drag.active || e.pointerId !== drag.id) return;
  drag.active = false;
  try { dom.handle.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
  dom.stage.classList.remove("is-dragging");
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 0);
  if (e.pointerType === "touch") { clearTimeout(tipTimer); tipTimer = setTimeout(() => hover(null), 1500); }
}
dom.handle.addEventListener("pointerup", endDrag);
dom.handle.addEventListener("pointercancel", endDrag);

/* Keyboard: the handle is a slider, the angle marker is a button */
dom.handle.addEventListener("keydown", (e) => {
  const step = e.shiftKey ? 500 : 50;
  let next = null;
  if (e.key === "ArrowUp" || e.key === "ArrowRight") next = state.heightMm + step;
  else if (e.key === "ArrowDown" || e.key === "ArrowLeft") next = state.heightMm - step;
  else if (e.key === "PageUp") next = state.heightMm + 500;
  else if (e.key === "PageDown") next = state.heightMm - 500;
  else if (e.key === "Home") next = SLIDER_MIN;
  else if (e.key === "End") next = SLIDER_MAX;
  if (next === null) return;
  e.preventDefault();
  setHeightFromUI(next);
});
dom.handle.addEventListener("focus", () => hoverByFocus(dom.handle));
dom.handle.addEventListener("blur", () => hover(null));

dom.angleSector.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setAngle(state.angle === 30 ? 35 : 30); }
});
dom.angleSector.addEventListener("focus", () => hoverByFocus(dom.angleSector));
dom.angleSector.addEventListener("blur", () => hover(null));

/* The two comparison rows work as buttons */
[[dom.c30row, 30], [dom.c35row, 35]].forEach((pair) => {
  const row = pair[0], a = pair[1];
  row.setAttribute("role", "button");
  row.tabIndex = 0;
  row.setAttribute("aria-label", "Use " + a + " degrees");
  row.addEventListener("click", () => setAngle(a));
  row.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setAngle(a); }
  });
});

/* Panels light up the matching part of the drawing */
document.querySelectorAll("[data-link]").forEach((n) => {
  const key = n.getAttribute("data-link");
  n.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") setHot(key, true); });
  n.addEventListener("pointerleave", () => setHot(key, false));
  n.addEventListener("focusin", () => setHot(key, true));
  n.addEventListener("focusout", () => setHot(key, false));
});


/* =====================================================================
   12. START
   ===================================================================== */
(function init() {
  applyTheme(currentTheme(), false);

  const savedUnit = store.get(KEY.unit);
  if (savedUnit && UNITS[savedUnit]) {
    state.unit = savedUnit;
    const radio = document.querySelector('input[name="unit"][value="' + savedUnit + '"]');
    if (radio) radio.checked = true;
  }
  setText(dom.unitTag, UNITS[state.unit].label);
  setText(dom.baseUnit, UNITS[state.unit].label);

  loadLog();
  writeHeightField();
  updateFs();
  commit();
  renderLog();

  // Opening moment: the escalator grows from a short, steeper start to the chosen size.
  if (!REDUCED) { state.cur.h = 1400; state.cur.a = 35; }
  else { state.cur.h = state.target.h; state.cur.a = state.target.a; }
  dom.playBtn.classList.toggle("is-paused", !state.playing);
  setText(dom.playLabel, state.playing ? "Pause" : "Play");

  lastT = performance.now();
  requestAnimationFrame(frame);
})();
