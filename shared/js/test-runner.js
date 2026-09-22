/**
 * test-runner.js
 * The production test list, shared by every instrument's test.html.
 *
 * An instrument passes an ordered list of tests plus any test types of its own;
 * the runner builds one row per test, keeps per-test state, and re-renders rows
 * (fill band, rest zone, cursor, detail text, faceplate colors) as MIDI arrives.
 * The list is cleared and restarted every time a device connects or disconnects.
 *
 * Built-in test types:
 *   'firmware' — passes when a firmware version ≥ firmwareMin is received
 *   'serial'   — passes once a serial number is received ('midi-serial-number')
 *   'cc'       — passes when the value has been seen across the required range
 *                (min ≤ lo threshold, max ≥ hi threshold, from coveragePct); with
 *                `rest: [lo, hi]` it must additionally be left within that window.
 *                Fed automatically from 'midi-cc' when the test has a `cc` number,
 *                or by calling observe(id, value) for values derived elsewhere
 *                (e.g. tempo measured from MIDI clock). `format(v)` renders values
 *                in the detail text (default: the raw 0–127 number), followed
 *                by `unit` if given.
 *
 * A test type is an object of hooks (all but init/passed/fill/detail optional):
 *   init(t)              → fresh per-test state
 *   passed(t, m)         → boolean
 *   fill(t, m)           → [start, end] fill band as fractions 0–1
 *   detail(t, m)         → text for the value column
 *   zone(t, m)           → [start, end] rest window band (read once, at build time)
 *   cursor(t, m)         → cursor position 0–1, or null for none yet
 *   background(t, m, passed) → CSS background overriding the fill band ('' = none)
 *   faceplate(t, m, passed)  → color the test's SVG elements (see setElState)
 *   render(t, m, li)     → any other per-row DOM work
 *
 * `half: true` on a test renders it at half width so two fit on one row.
 */

export const CC_MIN = 0;
export const CC_MAX = 127;

// Rest windows [lo, hi] (inclusive): where a control must be left for the test to pass.
export const REST_CENTER = [59, 67]; // sliders / pots returned to the middle
export const REST_LOW = [0, 4];      // buttons / pads released

const FACEPLATE_STATES = ['test-idle', 'test-active', 'test-done'];

/** Put exactly one of .test-idle / .test-active / .test-done on an SVG element. */
export function setElState(el, cls) {
  if (!el || el.classList.contains(cls)) return;
  el.classList.remove(...FACEPLATE_STATES);
  el.classList.add(cls);
}

/** Parse "v1.2.3" / "1.2.3" into [1, 2, 3]; null if unparseable. */
function parseVersion(v) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(v ?? '');
  return match ? match.slice(1, 4).map(Number) : null;
}

/** Is version string `v` at least `min`? */
function versionAtLeast(v, min) {
  const got = parseVersion(v);
  if (!got) return false;
  const want = parseVersion(min);
  for (let i = 0; i < 3; i++) {
    if (got[i] !== want[i]) return got[i] > want[i];
  }
  return true;
}

/**
 * @param {object}   opts
 * @param {object[]} opts.tests        ordered test list
 * @param {object}   [opts.types]      instrument-specific test types, by name
 * @param {string}   opts.firmwareMin  minimum firmware version, e.g. '1.0.0'
 * @param {number}   [opts.coveragePct=90] share of the 0–127 range a 'cc' test must sweep
 * @param {Function} [opts.faceplateEls]   (t) → SVG elements showing a 'cc' test's state
 * @param {Function} [opts.onReset]    called at the start of every reset
 * @param {Element}  opts.listEl       the <ol> to build rows in
 * @param {Element}  opts.statusEl     MIDI status; shown in the firmware row until a version arrives
 */
export function createTestRunner({
  tests, types = {}, firmwareMin, coveragePct = 90, faceplateEls = () => [],
  onReset, listEl, statusEl,
}) {
  // Required [lo, hi] thresholds for coveragePct, centered on the range.
  const margin = Math.round((CC_MAX - CC_MIN) * (1 - coveragePct / 100) / 2);
  const th = { lo: CC_MIN + margin, hi: CC_MAX - margin };

  const rangeCovered = m => m.seen && m.min <= th.lo && m.max >= th.hi;
  const atRest = (t, m) => m.current !== null && m.current >= t.rest[0] && m.current <= t.rest[1];
  const firmwareOk = v => versionAtLeast(v, firmwareMin);

  const builtins = {
    firmware: {
      init: () => ({ version: null }),
      passed: (t, m) => firmwareOk(m.version),
      fill: (t, m) => firmwareOk(m.version) ? [0, 1] : [0, 0],
      detail: (t, m) => m.version === null ? ''
        : firmwareOk(m.version) ? `${m.version} ✓` : `${m.version} → ≥ ${firmwareMin}`,
      // "1.0.0 ✓" already implies a connection, so the status gives way to it
      render: (t, m) => { statusEl.hidden = m.version !== null; },
    },

    serial: {
      init: () => ({ serial: null }),
      passed: (t, m) => m.serial !== null,
      fill: (t, m) => m.serial !== null ? [0, 1] : [0, 0],
      detail: (t, m) => m.serial ?? '—',
    },

    cc: {
      init: () => ({ seen: false, min: Infinity, max: -Infinity, current: null }),
      passed: (t, m) => rangeCovered(m) && (!t.rest || atRest(t, m)),
      fill: (t, m) => m.seen ? [m.min / CC_MAX, m.max / CC_MAX] : [0, 0],
      zone: t => t.rest ? [t.rest[0] / CC_MAX, (t.rest[1] + 1) / CC_MAX] : null,
      cursor: (t, m) => m.current === null ? null : m.current / CC_MAX,
      faceplate: (t, m, passed) => {
        const cls = passed ? 'test-done' : m.seen ? 'test-active' : 'test-idle';
        for (const el of faceplateEls(t)) setElState(el, cls);
      },
      detail: (t, m) => {
        if (!m.seen) return '—';
        const f = t.format ?? String;
        const u = t.unit ? ` ${t.unit}` : '';
        const parts = [`range ${f(m.min)} – ${f(m.max)}${u}${rangeCovered(m) ? ' ✓' : ''}`];
        parts.push(`${f(m.current)}${u}${t.rest ? (atRest(t, m) ? ' ✓' : ` → ${f(t.rest[0])}–${f(t.rest[1])}${u}`) : ''}`);
        return parts.join('   ·   ');
      },
    },
  };

  const allTypes = { ...builtins, ...types };
  const typeOf = t => allTypes[t.type];

  // Mutable per-run state, keyed by test id.
  let state = {};
  let renderQueued = false;

  function reset() {
    onReset?.();
    state = {};
    for (const t of tests) state[t.id] = { ...typeOf(t).init(t), wasPassed: false };
    buildList();
    renderNow();
  }

  /** Build one persistent <li> per test; render() updates them in place. */
  function buildList() {
    listEl.innerHTML = '';
    for (const t of tests) {
      const m = state[t.id];
      const li = document.createElement('li');
      li.className = 'test';
      if (t.half) li.classList.add('half');
      const zone = typeOf(t).zone?.(t, m);
      if (zone) {
        li.classList.add('has-rest');
        li.style.setProperty('--zone-start', zone[0]);
        li.style.setProperty('--zone-end', zone[1]);
      }
      const row = document.createElement('div');
      row.className = 'test-row';
      const title = document.createElement('div');
      title.className = 'test-title';
      title.textContent = t.label;
      const detail = document.createElement('div');
      detail.className = 'test-detail';
      // The MIDI connection status lives in the firmware row's value column
      // (kept on one line so the list fits a laptop screen).
      if (t.type === 'firmware') row.append(title, statusEl, detail);
      else row.append(title, detail);
      li.append(row);
      listEl.appendChild(li);
      m.el = li;
      m.detailEl = detail;
    }
  }

  /** Restart the detent animation on a row. */
  function punch(li) {
    li.classList.remove('snap');
    void li.offsetWidth;
    li.classList.add('snap');
  }

  function renderNow() {
    renderQueued = false;
    for (const t of tests) {
      const type = typeOf(t);
      const m = state[t.id];
      const li = m.el;
      const passed = type.passed(t, m);
      li.classList.toggle('done', passed);
      // Punch once when the item turns green.
      if (passed && !m.wasPassed) punch(li);
      m.wasPassed = passed;

      type.faceplate?.(t, m, passed);

      const [start, end] = type.fill(t, m);
      li.style.setProperty('--fill-start', start);
      li.style.setProperty('--fill-end', end);
      if (type.background) li.style.background = type.background(t, m, passed);

      const cursor = type.cursor?.(t, m);
      if (cursor != null) {
        li.classList.add('has-cursor');
        li.style.setProperty('--cursor', cursor);
      }

      m.detailEl.textContent = type.detail(t, m);
      type.render?.(t, m, li);
    }
  }

  /** Re-render on the next animation frame; bursts of MIDI coalesce into one pass. */
  function render() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(renderNow);
  }

  /** Record a value (0–127) for a 'cc' test. */
  function observeTest(t, value) {
    const m = state[t.id];
    m.seen = true;
    m.min = Math.min(m.min, value);
    m.max = Math.max(m.max, value);
    m.current = value;
  }

  /** Feed a value to the 'cc' test with this id (for values not from a CC). */
  function observe(id, value) {
    const t = tests.find(x => x.id === id);
    if (!t) return;
    observeTest(t, value);
    render();
  }

  /** Tests of the given type, each with its current state. */
  function each(type) {
    return tests.filter(t => t.type === type).map(t => [t, state[t.id]]);
  }

  document.addEventListener('midi-connected', reset);
  document.addEventListener('midi-disconnected', reset);
  document.addEventListener('midi-firmware-version', e => {
    for (const [, m] of each('firmware')) m.version = e.detail.version;
    render();
  });
  document.addEventListener('midi-serial-number', e => {
    for (const [, m] of each('serial')) m.serial = e.detail.serial;
    render();
  });
  document.addEventListener('midi-cc', e => {
    const { cc, value } = e.detail;
    let touched = false;
    for (const t of tests) {
      if (t.type !== 'cc' || t.cc !== cc) continue;
      observeTest(t, value);
      touched = true;
    }
    if (touched) render();
  });

  reset();

  return { render, observe, each };
}
