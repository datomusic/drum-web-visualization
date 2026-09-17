/**
 * test.js
 * Entry point for test.html — the manufacturing production test.
 *
 * Each test item watches a set of MIDI CCs. A CC-based test passes once every
 * one of its CCs has been received AND the observed values span the required
 * portion of the 0–127 range (min ≤ lo threshold, max ≥ hi threshold).
 *
 * The test list is cleared and restarted every time a DRUM connects or disconnects.
 */

import { initMIDI } from './midi.js';
import { initVisualizer } from './visualizer.js';
import { CC_CONTROLS, NOTE_CONTROLS, STEP_LED_IDS, TRACK_STEP_MAP } from './controls.js';

const CC_MIN = 0;
const CC_MAX = 127;

// Minimum firmware version required to pass the firmware test.
const FIRMWARE_MIN_VERSION = '1.0.0';

// Percentage of the 0–127 range a control must sweep to pass (centered on the range).
const COVERAGE_PCT = 90;

// Rest windows [lo, hi] (inclusive): where a control must be left for the test to pass.
const REST_CENTER = [59, 67]; // sliders / pots returned to the middle
const REST_LOW = [0, 4];      // pads released

// Drum pads: the sequencer and sample select buttons emit velocity 100, so anything
// above that must be a physical pad hit. A pad passes after PAD_HITS such notes.
const PAD_VELOCITY_MIN = 101;
const PAD_HITS = 3;

// Sequencer: 4 tracks × 8 steps, read from the periodic sequencer-state poll.
const SEQ_TRACKS = 4;
const SEQ_STEPS = 8;
/**
 * Final pattern the device must be left in, as step offsets relative to the kick
 * (any rotation of the ring is accepted): kick on track 1, snare on track 3
 * opposite it, two hats on track 4 in between, track 2 empty.
 */
const FINAL_PATTERN = { 1: [0], 2: [4], 3: [], 4: [2, 6] };

/**
 * Ordered list of tests — one list item per element. Extend this array to add tests.
 * type:
 *   'firmware' — passes when a firmware version ≥ FIRMWARE_MIN_VERSION is received
 *   'cc'       — passes when the CC has been received across the required range;
 *                with `rest: [lo, hi]` it must additionally be left within that window
 *   'notes'    — passes once every note of the given track (from NOTE_CONTROLS) has
 *                been received at least once; the bar fills per note in the note's color.
 *                With `rest: note` that note must additionally be the last one received.
 *                Also requires both sample-select buttons to have been seen working:
 *                one step up (note+1) and one step down (note-1), wraparounds excluded
 *   'pad'      — passes once PAD_HITS notes of the track were received with velocity
 *                ≥ PAD_VELOCITY_MIN (i.e. struck on the drum pad, not the sequencer)
 *   'sequencer' — passes once every one of the 32 steps has been seen both on and off,
 *                and the sequencer is left in FINAL_PATTERN
 *
 * `half: true` renders the test at half width so two fit on one row.
 */
const TESTS = [
  { id: 'firmware',  label: 'Firmware version', type: 'firmware' },
  { id: 'slider-1',   label: 'Slider 1',     type: 'cc', cc: 21, rest: REST_CENTER },
  { id: 'slider-2',   label: 'Slider 2',     type: 'cc', cc: 22, rest: REST_CENTER },
  { id: 'slider-3',   label: 'Slider 3',     type: 'cc', cc: 23, rest: REST_CENTER },
  { id: 'slider-4',   label: 'Slider 4',     type: 'cc', cc: 24, rest: REST_CENTER },
  { id: 'pot-volume', label: 'Volume',   type: 'cc', cc: 7,  rest: REST_CENTER },
  { id: 'pot-tempo',  label: 'Tempo',    type: 'cc', cc: 15, rest: REST_CENTER },
  { id: 'swing',      label: 'Swing',    type: 'cc', cc: 9,  rest: REST_CENTER },
  { id: 'pad-crush',  label: 'Crush',    type: 'cc', cc: 12, rest: REST_LOW, half: true },
  { id: 'pad-random', label: 'Random',   type: 'cc', cc: 16, rest: REST_LOW, half: true },
  { id: 'pad-repeat', label: 'Repeat',   type: 'cc', cc: 17, rest: REST_LOW, half: true },
  { id: 'pad-filter', label: 'Filter',   type: 'cc', cc: 74, rest: REST_LOW, half: true },
  { id: 'notes-1',    label: 'Track 1 notes', type: 'notes', track: 1, rest: 36 },
  { id: 'notes-2',    label: 'Track 2 notes', type: 'notes', track: 2, rest: 38 },
  { id: 'notes-3',    label: 'Track 3 notes', type: 'notes', track: 3, rest: 46 },
  { id: 'notes-4',    label: 'Track 4 notes', type: 'notes', track: 4, rest: 54 },
  { id: 'pad-1',      label: 'Pad 1',   type: 'pad', track: 1, half: true },
  { id: 'pad-2',      label: 'Pad 2',   type: 'pad', track: 2, half: true },
  { id: 'pad-3',      label: 'Pad 3',   type: 'pad', track: 3, half: true },
  { id: 'pad-4',      label: 'Pad 4',   type: 'pad', track: 4, half: true },
  { id: 'sequencer',  label: 'Sequencer',     type: 'sequencer' },
];

/** SVG elements on the faceplate that show a CC test's state (idle / active / done). */
function faceplateEls(t) {
  if (t.type !== 'cc') return [];
  const ctrl = CC_CONTROLS[t.cc];
  if (!ctrl) return [];
  // Sliders also color their track so the whole control reads as one bar
  const trackId = ctrl.id === 'slider-swing'
    ? 'slider-swing-track'
    : ctrl.indicatorId?.replace('pitch-indicator-', 'pitch-slider-track-');
  return [ctrl.id, ctrl.indicatorId, trackId]
    .filter(Boolean)
    .map(id => document.getElementById(id))
    .filter(Boolean);
}

const FACEPLATE_STATES = ['test-idle', 'test-active', 'test-done'];

function setFaceplateState(t, cls) {
  for (const el of faceplateEls(t)) setElState(el, cls);
}

function setElState(el, cls) {
  if (!el) return;
  el.classList.remove(...FACEPLATE_STATES);
  el.classList.add(cls);
}

/** Notes belonging to a track, ordered by sample number. */
function trackNotes(track) {
  return Object.entries(NOTE_CONTROLS)
    .filter(([, n]) => n.track === track)
    .sort((a, b) => a[1].sample - b[1].sample)
    .map(([note, n]) => ({ note: Number(note), color: n.color }));
}

const listEl = document.getElementById('test-list');
const statusEl = document.getElementById('midi-status');

// Mutable per-run state, keyed by test id.
let state = {};

initVisualizer();
initMIDI(statusEl);
resetTests();

document.addEventListener('midi-connected', resetTests);
document.addEventListener('midi-disconnected', resetTests);
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
document.addEventListener('midi-note-on', e => {
  const { note, velocity } = e.detail;
  let touched = false;
  for (const t of TESTS) {
    if (t.type === 'pad') {
      if (velocity < PAD_VELOCITY_MIN || NOTE_CONTROLS[note]?.track !== t.track) continue;
      state[t.id].hits++;
      touched = true;
      continue;
    }
    if (t.type !== 'notes') continue;
    const m = state[t.id];
    if (!(note in m.heard)) continue;
    m.heard[note] = true;
    // Sample select: a ±1 step from the previous note. Wraparound (first↔last of
    // the track) is a jump of 7, so it never counts.
    if (m.last !== null) {
      if (note === m.last + 1) m.up = true;
      if (note === m.last - 1) m.down = true;
    }
    m.last = note;
    touched = true;
  }
  if (touched) render();
});

document.addEventListener('midi-sequencer-state', e => {
  const on = e.detail.stepVelocities.slice(0, SEQ_TRACKS * SEQ_STEPS).map(v => v > 0);
  for (const t of TESTS) {
    if (t.type !== 'sequencer') continue;
    const m = state[t.id];
    m.current = on;
    on.forEach((lit, i) => { if (lit) m.seenOn[i] = true; else m.seenOff[i] = true; });
  }
  render();
});

/** Index into the 32-step array for a 1-based track and 0-based step. */
function seqIndex(track, step) {
  return (track - 1) * SEQ_STEPS + step;
}

/** Does the current sequencer state equal FINAL_PATTERN at some rotation? */
function finalPatternMatch(current) {
  if (!current) return false;
  for (let rot = 0; rot < SEQ_STEPS; rot++) {
    let ok = true;
    for (let track = 1; track <= SEQ_TRACKS && ok; track++) {
      const want = new Set(FINAL_PATTERN[track].map(o => (o + rot) % SEQ_STEPS));
      for (let step = 0; step < SEQ_STEPS; step++) {
        if (current[seqIndex(track, step)] !== want.has(step)) { ok = false; break; }
      }
    }
    if (ok) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------

function resetTests() {
  state = {};
  for (const t of TESTS) {
    if (t.type === 'firmware') {
      state[t.id] = { version: null, wasPassed: false };
    } else if (t.type === 'cc') {
      state[t.id] = { seen: false, min: Infinity, max: -Infinity, current: null, wasPassed: false };
    } else if (t.type === 'notes') {
      const notes = trackNotes(t.track);
      state[t.id] = { notes, heard: Object.fromEntries(notes.map(n => [n.note, false])), last: null, up: false, down: false, wasPassed: false };
    } else if (t.type === 'pad') {
      state[t.id] = { hits: 0, wasPassed: false };
    } else if (t.type === 'sequencer') {
      const n = SEQ_TRACKS * SEQ_STEPS;
      state[t.id] = { seenOn: Array(n).fill(false), seenOff: Array(n).fill(false), current: null, wasPassed: false };
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

/** Parse "v1.2.3" / "1.2.3" into [1, 2, 3]; null if unparseable. */
function parseVersion(v) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(v ?? '');
  return match ? match.slice(1, 4).map(Number) : null;
}

/** Is firmware version string `v` at least FIRMWARE_MIN_VERSION? */
function firmwareOk(v) {
  const got = parseVersion(v);
  if (!got) return false;
  const min = parseVersion(FIRMWARE_MIN_VERSION);
  for (let i = 0; i < 3; i++) {
    if (got[i] !== min[i]) return got[i] > min[i];
  }
  return true;
}

function testPassed(t, th) {
  const m = state[t.id];
  if (t.type === 'firmware') return firmwareOk(m.version);
  if (t.type === 'pad') return m.hits >= PAD_HITS;
  if (t.type === 'sequencer') {
    return m.seenOn.every(Boolean) && m.seenOff.every(Boolean) && finalPatternMatch(m.current);
  }
  if (t.type === 'notes') {
    return m.notes.every(n => m.heard[n.note]) && m.up && m.down && (!t.rest || m.last === t.rest);
  }
  return rangeCovered(m, th) && (!t.rest || atRest(t, m));
}

/** Fill band [start, end] as fractions (0–1) of 0–127: the visited min..max range. */
function fillBand(t) {
  const m = state[t.id];
  if (t.type === 'firmware') return firmwareOk(m.version) ? [0, 1] : [0, 0];
  if (t.type === 'pad') return [0, Math.min(m.hits, PAD_HITS) / PAD_HITS];
  if (t.type === 'sequencer') {
    const both = m.seenOn.filter((v, i) => v && m.seenOff[i]).length;
    return [0, both / m.seenOn.length];
  }
  return m.seen ? [m.min / CC_MAX, m.max / CC_MAX] : [0, 0];
}

/** Build one persistent <li> per test; render() updates them in place. */
function buildList() {
  listEl.innerHTML = '';
  for (const t of TESTS) {
    const li = document.createElement('li');
    li.className = 'test';
    if (t.half) li.classList.add('half');
    if (t.type === 'cc' && t.rest) {
      li.classList.add('has-rest');
      li.style.setProperty('--zone-start', t.rest[0] / CC_MAX);
      li.style.setProperty('--zone-end', (t.rest[1] + 1) / CC_MAX);
    } else if (t.type === 'notes' && t.rest) {
      const notes = state[t.id].notes;
      const i = notes.findIndex(n => n.note === t.rest);
      li.classList.add('has-rest');
      li.style.setProperty('--zone-start', i / notes.length);
      li.style.setProperty('--zone-end', (i + 1) / notes.length);
    }
    const row = document.createElement('div');
    row.className = 'test-row';
    const title = document.createElement('div');
    title.className = 'test-title';
    title.textContent = t.label;
    const detail = document.createElement('div');
    detail.className = 'test-detail';
    row.append(title, detail);
    li.append(row);
    // The MIDI connection status ("Connected: DRUM (v1.0.0)") is redundant with
    // this row's own version detail — fold it in here instead of a separate line.
    if (t.type === 'firmware') li.append(statusEl);
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
    if (t.type === 'cc') {
      setFaceplateState(t, passed ? 'test-done' : m.seen ? 'test-active' : 'test-idle');
    }
    if (t.type === 'pad') {
      setElState(document.getElementById(`drumpad-${t.track}`), passed ? 'test-done' : m.hits > 0 ? 'test-active' : 'test-idle');
    }
    if (t.type === 'sequencer') {
      // Per step LED: green once seen both on and off, light blue once seen at all.
      for (let track = 1; track <= SEQ_TRACKS; track++) {
        for (let step = 0; step < SEQ_STEPS; step++) {
          const i = seqIndex(track, step);
          const el = document.getElementById(STEP_LED_IDS[TRACK_STEP_MAP[track][0] + step]);
          const both = m.seenOn[i] && m.seenOff[i];
          setElState(el, both ? 'test-done' : m.current ? 'test-active' : 'test-idle');
        }
      }
    }
    if (t.type === 'notes') {
      const anyHeard = m.last !== null;
      setElState(document.getElementById(`select-${t.track}-up`),   m.up   ? 'test-done' : anyHeard ? 'test-active' : 'test-idle');
      setElState(document.getElementById(`select-${t.track}-down`), m.down ? 'test-done' : anyHeard ? 'test-active' : 'test-idle');
    }
    const [start, end] = fillBand(t);
    li.style.setProperty('--fill-start', start);
    li.style.setProperty('--fill-end', end);

    // Notes: one segment per note, filled in the note's color once heard.
    if (t.type === 'notes') {
      const n = m.notes.length;
      const stops = m.notes.map((note, i) => {
        const c = m.heard[note.note] ? note.color : 'var(--color-gray)';
        return `${c} ${(i / n) * 100}% ${((i + 1) / n) * 100}%`;
      });
      li.style.background = passed ? '' : `linear-gradient(to right, ${stops.join(', ')})`;
      if (m.last !== null) {
        const i = m.notes.findIndex(x => x.note === m.last);
        li.classList.add('has-cursor');
        li.style.setProperty('--cursor', (i + 0.5) / n);
      }
    }

    if (t.type === 'cc' && m.current !== null) {
      li.classList.add('has-cursor');
      li.style.setProperty('--cursor', m.current / CC_MAX);
    }

    const detail = li.querySelector('.test-detail');
    if (t.type === 'firmware') {
      detail.textContent = m.version === null ? '—'
        : firmwareOk(m.version) ? `${m.version} ✓` : `${m.version} → ≥ ${FIRMWARE_MIN_VERSION}`;
    } else if (t.type === 'pad') {
      detail.textContent = `${Math.min(m.hits, PAD_HITS)} / ${PAD_HITS} hits`;
    } else if (t.type === 'sequencer') {
      if (!m.current) {
        detail.textContent = '—';
      } else {
        const n = m.seenOn.length;
        const on = m.seenOn.filter(Boolean).length;
        const off = m.seenOff.filter(Boolean).length;
        detail.textContent = [`${on} / ${n} on`, `${off} / ${n} off`, `pattern ${finalPatternMatch(m.current) ? '✓' : '·'}`].join('   ·   ');
      }
    } else if (t.type === 'notes') {
      const heard = m.notes.filter(n => m.heard[n.note]).length;
      const parts = [`${heard} / ${m.notes.length} notes`, `↑${m.up ? '✓' : '·'} ↓${m.down ? '✓' : '·'}`];
      if (t.rest && m.last !== null) parts.push(m.last === t.rest ? `last ${m.last} ✓` : `last ${m.last} → ${t.rest}`);
      detail.textContent = parts.join('   ·   ');
    } else if (!m.seen) {
      detail.textContent = '—';
    } else {
      const parts = [`range ${m.min} – ${m.max}${rangeCovered(m, th) ? ' ✓' : ''}`];
      parts.push(`${m.current}${t.rest ? (atRest(t, m) ? ' ✓' : ` → ${t.rest[0]}–${t.rest[1]}`) : ''}`);
      detail.textContent = parts.join('   ·   ');
    }
  }
}
