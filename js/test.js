/**
 * test.js
 * Entry point for test.html — the manufacturing production test.
 *
 * Each test item watches a set of MIDI CCs. A CC-based test passes once every
 * one of its CCs has been received AND the observed values span the required
 * portion of the 0–127 range (min ≤ lo threshold, max ≥ hi threshold).
 *
 * The test list is cleared and restarted every time a DRUM connects.
 */

import { initMIDI } from './midi.js';
import { initVisualizer } from './visualizer.js';

const CC_MIN = 0;
const CC_MAX = 127;

// Percentage of the 0–127 range a control must sweep to pass (centered on the range).
const COVERAGE_PCT = 90;

// Rest windows [lo, hi] (inclusive): where a control must be left for the test to pass.
const REST_CENTER = [60, 66]; // sliders / pots returned to the middle
const REST_LOW = [0, 4];      // pads released

/**
 * Ordered list of tests — one list item per element. Extend this array to add tests.
 * type:
 *   'firmware' — passes when a firmware version response is received
 *   'cc'       — passes when the CC has been received across the required range;
 *                with `rest: [lo, hi]` it must additionally be left within that window
 */
const TESTS = [
  { id: 'firmware',  label: 'Firmware version', type: 'firmware' },
  { id: 'slider-1',   label: 'Slider 1',     type: 'cc', cc: 21, rest: REST_CENTER },
  { id: 'slider-2',   label: 'Slider 2',     type: 'cc', cc: 22, rest: REST_CENTER },
  { id: 'slider-3',   label: 'Slider 3',     type: 'cc', cc: 23, rest: REST_CENTER },
  { id: 'slider-4',   label: 'Slider 4',     type: 'cc', cc: 24, rest: REST_CENTER },
  { id: 'pot-volume', label: 'Volume pot',   type: 'cc', cc: 7,  rest: REST_CENTER },
  { id: 'pot-tempo',  label: 'Tempo pot',    type: 'cc', cc: 15, rest: REST_CENTER },
  { id: 'swing',      label: 'Swing switch', type: 'cc', cc: 9,  rest: REST_CENTER },
  { id: 'pad-crush',  label: 'Crush pad',    type: 'cc', cc: 12, rest: REST_LOW },
  { id: 'pad-random', label: 'Random pad',   type: 'cc', cc: 16, rest: REST_LOW },
  { id: 'pad-repeat', label: 'Repeat pad',   type: 'cc', cc: 17, rest: REST_LOW },
  { id: 'pad-filter', label: 'Filter pad',   type: 'cc', cc: 74, rest: REST_LOW },
];

const listEl = document.getElementById('test-list');
const statusEl = document.getElementById('midi-status');

// Mutable per-run state, keyed by test id.
let state = {};

initVisualizer();
initMIDI(statusEl);
resetTests();

document.addEventListener('midi-connected', resetTests);
document.addEventListener('midi-firmware-version', e => {
  for (const t of TESTS) {
    if (t.type === 'firmware') state[t.id].version = e.detail.version;
  }
  render();
});
document.addEventListener('midi-cc', e => {
  const { cc, value } = e.detail;
  let touched = false;
  for (const t of TESTS) {
    if (t.type !== 'cc' || t.cc !== cc) continue;
    const m = state[t.id];
    m.seen = true;
    m.min = Math.min(m.min, value);
    m.max = Math.max(m.max, value);
    m.current = value;
    touched = true;
  }
  if (touched) render();
});

// ---------------------------------------------------------------------------

function resetTests() {
  state = {};
  for (const t of TESTS) {
    if (t.type === 'firmware') {
      state[t.id] = { version: null, wasPassed: false };
    } else if (t.type === 'cc') {
      state[t.id] = { seen: false, min: Infinity, max: -Infinity, current: null, wasPassed: false };
    }
  }
  buildList();
  render();
}

/** Required [lo, hi] thresholds for COVERAGE_PCT. */
function thresholds() {
  const margin = Math.round((CC_MAX - CC_MIN) * (1 - COVERAGE_PCT / 100) / 2);
  return { lo: CC_MIN + margin, hi: CC_MAX - margin };
}

function rangeCovered(m, { lo, hi }) {
  return m.seen && m.min <= lo && m.max >= hi;
}

function atRest(t, m) {
  return m.current !== null && m.current >= t.rest[0] && m.current <= t.rest[1];
}

function testPassed(t, th) {
  const m = state[t.id];
  if (t.type === 'firmware') return m.version !== null;
  return rangeCovered(m, th) && (!t.rest || atRest(t, m));
}

/** Fill band [start, end] as fractions (0–1) of 0–127: the visited min..max range. */
function fillBand(t) {
  const m = state[t.id];
  if (t.type === 'firmware') return m.version !== null ? [0, 1] : [0, 0];
  return m.seen ? [m.min / CC_MAX, m.max / CC_MAX] : [0, 0];
}

/** Build one persistent <li> per test; render() updates them in place. */
function buildList() {
  listEl.innerHTML = '';
  for (const t of TESTS) {
    const li = document.createElement('li');
    li.className = 'test';
    if (t.rest) {
      li.classList.add('has-rest');
      li.style.setProperty('--zone-start', t.rest[0] / CC_MAX);
      li.style.setProperty('--zone-end', (t.rest[1] + 1) / CC_MAX);
    }
    const title = document.createElement('div');
    title.className = 'test-title';
    title.textContent = t.label;
    const detail = document.createElement('div');
    detail.className = 'test-detail';
    li.append(title, detail);
    listEl.appendChild(li);
    state[t.id].el = li;
  }
}

/** Restart the detent animation on a row. */
function punch(li) {
  li.classList.remove('snap');
  void li.offsetWidth;
  li.classList.add('snap');
}

function render() {
  const th = thresholds();

  for (const t of TESTS) {
    const m = state[t.id];
    const li = m.el;
    const passed = testPassed(t, th);
    li.classList.toggle('done', passed);
    // Punch once when the item turns green.
    if (passed && !m.wasPassed) punch(li);
    m.wasPassed = passed;
    const [start, end] = fillBand(t);
    li.style.setProperty('--fill-start', start);
    li.style.setProperty('--fill-end', end);

    if (t.type === 'cc' && m.current !== null) {
      li.classList.add('has-cursor');
      li.style.setProperty('--cursor', m.current / CC_MAX);
    }

    const detail = li.querySelector('.test-detail');
    if (t.type === 'firmware') {
      detail.textContent = m.version ?? '—';
    } else if (!m.seen) {
      detail.textContent = 'not received';
    } else {
      const parts = [`range ${m.min} – ${m.max}${rangeCovered(m, th) ? ' ✓' : ''}`];
      parts.push(`now ${m.current}${t.rest ? (atRest(t, m) ? ' ✓' : ` → ${t.rest[0]}–${t.rest[1]}`) : ''}`);
      detail.textContent = parts.join('   ·   ');
    }
  }
}
