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

// A control that must be returned to center passes only when its current
// value is within CENTER ± CENTER_TOLERANCE (i.e. 60–66).
const CENTER = 63;
const CENTER_TOLERANCE = 3;

/**
 * Ordered list of tests — one list item per element. Extend this array to add tests.
 * type:
 *   'firmware' — passes when a firmware version response is received
 *   'cc'       — passes when the CC has been received across the required range;
 *                with `center: true` it must additionally be left at the middle position
 */
const TESTS = [
  { id: 'firmware',  label: 'Firmware version', type: 'firmware' },
  { id: 'slider-1',  label: 'Slider 1',         type: 'cc', cc: 21, center: true },
  { id: 'slider-2',  label: 'Slider 2',         type: 'cc', cc: 22, center: true },
  { id: 'slider-3',  label: 'Slider 3',         type: 'cc', cc: 23, center: true },
  { id: 'slider-4',  label: 'Slider 4',         type: 'cc', cc: 24, center: true },
  { id: 'pot-volume',    label: 'Volume pot',    type: 'cc', cc: 7,  center: true },
  { id: 'pot-tempo',     label: 'Tempo pot',     type: 'cc', cc: 15, center: true },
  { id: 'swing',     label: 'Swing switch',     type: 'cc', cc: 9, center: true },
  { id: 'pad-crush',  label: 'Crush pad',  type: 'cc', cc: 12 },
  { id: 'pad-random', label: 'Random pad', type: 'cc', cc: 16 },
  { id: 'pad-repeat', label: 'Repeat pad', type: 'cc', cc: 17 },
  { id: 'pad-filter', label: 'Filter pad', type: 'cc', cc: 74 },
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
      state[t.id] = { version: null };
    } else if (t.type === 'cc') {
      state[t.id] = { seen: false, min: Infinity, max: -Infinity, current: null };
    }
  }
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

function isCentered(m) {
  return m.current !== null && Math.abs(m.current - CENTER) <= CENTER_TOLERANCE;
}

function testPassed(t, th) {
  const m = state[t.id];
  if (t.type === 'firmware') return m.version !== null;
  return rangeCovered(m, th) && (!t.center || isCentered(m));
}

/** Fill band [start, end] as fractions (0–1) of 0–127: the visited min..max range. */
function fillBand(t) {
  const m = state[t.id];
  if (t.type === 'firmware') return m.version !== null ? [0, 1] : [0, 0];
  return m.seen ? [m.min / CC_MAX, m.max / CC_MAX] : [0, 0];
}

function render() {
  const th = thresholds();
  listEl.innerHTML = '';

  for (const t of TESTS) {
    const passed = testPassed(t, th);
    const li = document.createElement('li');
    li.className = `test ${passed ? 'done' : ''}`;
    const [start, end] = fillBand(t);
    li.style.setProperty('--fill-start', start);
    li.style.setProperty('--fill-end', end);
    if (t.type === 'cc' && state[t.id].current !== null) {
      li.classList.add('has-cursor');
      li.style.setProperty('--cursor', state[t.id].current / CC_MAX);
    }

    const title = document.createElement('div');
    title.className = 'test-title';
    title.textContent = t.label;
    li.appendChild(title);

    const detail = document.createElement('div');
    detail.className = 'test-detail';
    const m = state[t.id];
    if (t.type === 'firmware') {
      detail.textContent = m.version ?? '—';
    } else if (!m.seen) {
      detail.textContent = 'not received';
    } else {
      const parts = [`range ${m.min} – ${m.max}${rangeCovered(m, th) ? ' ✓' : ''}`];
      parts.push(`now ${m.current}${t.center ? (isCentered(m) ? ' ✓' : ' → center') : ''}`);
      detail.textContent = parts.join('   ·   ');
    }
    li.appendChild(detail);
    listEl.appendChild(li);
  }
}
