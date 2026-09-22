/**
 * test.js
 * Entry point for drum/test.html — the DRUM manufacturing production test.
 *
 * The list, the built-in 'firmware' and 'cc' tests and the row rendering live in
 * shared/js/test-runner.js; this file defines the DRUM's tests and its own test
 * types (drum pads, sample select notes, sequencer).
 */

import { initMIDI } from '../../shared/js/midi.js';
import { createTestRunner, setElState, REST_CENTER, REST_LOW } from '../../shared/js/test-runner.js';
import { DRUM } from './device.js';
import { initVisualizer } from './visualizer.js';
import { initTone, setToneCC, muteTone } from './tone.js';
import { CC_CONTROLS, NOTE_CONTROLS, STEP_LED_IDS, TRACK_STEP_MAP } from './controls.js';

// Minimum firmware version required to pass the firmware test.
const FIRMWARE_MIN_VERSION = '1.0.0';

// The sine wave for the line-in test follows this CC (PITCH1 slider).
const TONE_PITCH_CC = 21;

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
 * Types beyond the runner's built-in 'firmware' and 'cc' (see test-runner.js):
 *   'notes'    — passes once every note of the given track (from NOTE_CONTROLS) has
 *                been received at least once; the bar fills per note in the note's color.
 *                With `rest: note` that note must additionally be the last one received.
 *                Also requires both sample-select buttons to have been seen working:
 *                one step up (note+1) and one step down (note-1), wraparounds excluded
 *   'pad'      — passes once PAD_HITS notes of the track were received with velocity
 *                ≥ PAD_VELOCITY_MIN (i.e. struck on the drum pad, not the sequencer)
 *   'sequencer' — passes once every one of the 32 steps has been seen both on and off,
 *                and the sequencer is left in FINAL_PATTERN
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

/** Notes belonging to a track, ordered by sample number. */
function trackNotes(track) {
  return Object.entries(NOTE_CONTROLS)
    .filter(([, n]) => n.track === track)
    .sort((a, b) => a[1].sample - b[1].sample)
    .map(([note, n]) => ({ note: Number(note), color: n.color }));
}

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
// DRUM test types
// ---------------------------------------------------------------------------

const notesPassed = (t, m) =>
  m.notes.every(n => m.heard[n.note]) && m.up && m.down && (!t.rest || m.last === t.rest);

const TYPES = {
  notes: {
    init: t => {
      const notes = trackNotes(t.track);
      return { notes, heard: Object.fromEntries(notes.map(n => [n.note, false])), last: null, up: false, down: false };
    },
    passed: notesPassed,
    fill: () => [0, 0],
    zone: (t, m) => {
      if (!t.rest) return null;
      const i = m.notes.findIndex(n => n.note === t.rest);
      return [i / m.notes.length, (i + 1) / m.notes.length];
    },
    // One segment per note, filled in the note's color once heard.
    background: (t, m, passed) => {
      if (passed) return '';
      const n = m.notes.length;
      const stops = m.notes.map((note, i) => {
        const c = m.heard[note.note] ? note.color : 'var(--color-gray)';
        return `${c} ${(i / n) * 100}% ${((i + 1) / n) * 100}%`;
      });
      return `linear-gradient(to right, ${stops.join(', ')})`;
    },
    cursor: (t, m) => {
      if (m.last === null) return null;
      const i = m.notes.findIndex(x => x.note === m.last);
      return (i + 0.5) / m.notes.length;
    },
    faceplate: (t, m) => {
      const anyHeard = m.last !== null;
      setElState(document.getElementById(`select-${t.track}-up`),   m.up   ? 'test-done' : anyHeard ? 'test-active' : 'test-idle');
      setElState(document.getElementById(`select-${t.track}-down`), m.down ? 'test-done' : anyHeard ? 'test-active' : 'test-idle');
    },
    detail: (t, m) => {
      const heard = m.notes.filter(n => m.heard[n.note]).length;
      const parts = [`${heard} / ${m.notes.length} notes`, `↑${m.up ? '✓' : '·'} ↓${m.down ? '✓' : '·'}`];
      if (t.rest && m.last !== null) parts.push(m.last === t.rest ? `last ${m.last} ✓` : `last ${m.last} → ${t.rest}`);
      return parts.join('   ·   ');
    },
  },

  pad: {
    init: () => ({ hits: 0 }),
    passed: (t, m) => m.hits >= PAD_HITS,
    fill: (t, m) => [0, Math.min(m.hits, PAD_HITS) / PAD_HITS],
    faceplate: (t, m, passed) => {
      setElState(document.getElementById(`drumpad-${t.track}`), passed ? 'test-done' : m.hits > 0 ? 'test-active' : 'test-idle');
    },
    detail: (t, m) => `${Math.min(m.hits, PAD_HITS)} / ${PAD_HITS} hits`,
  },

  sequencer: {
    init: () => {
      const n = SEQ_TRACKS * SEQ_STEPS;
      return { seenOn: Array(n).fill(false), seenOff: Array(n).fill(false), current: null };
    },
    passed: (t, m) => m.seenOn.every(Boolean) && m.seenOff.every(Boolean) && finalPatternMatch(m.current),
    fill: (t, m) => {
      const both = m.seenOn.filter((v, i) => v && m.seenOff[i]).length;
      return [0, both / m.seenOn.length];
    },
    // Per step LED: green once seen both on and off, light blue once seen at all.
    faceplate: (t, m) => {
      for (let track = 1; track <= SEQ_TRACKS; track++) {
        for (let step = 0; step < SEQ_STEPS; step++) {
          const i = seqIndex(track, step);
          const el = document.getElementById(STEP_LED_IDS[TRACK_STEP_MAP[track][0] + step]);
          const both = m.seenOn[i] && m.seenOff[i];
          setElState(el, both ? 'test-done' : m.current ? 'test-active' : 'test-idle');
        }
      }
    },
    detail: (t, m) => {
      if (!m.current) return '—';
      const n = m.seenOn.length;
      const on = m.seenOn.filter(Boolean).length;
      const off = m.seenOff.filter(Boolean).length;
      return [`${on} / ${n} on`, `${off} / ${n} off`, `pattern ${finalPatternMatch(m.current) ? '✓' : '·'}`].join('   ·   ');
    },
  },
};

// ---------------------------------------------------------------------------

const statusEl = document.getElementById('midi-status');

initVisualizer();
initTone(document.getElementById('tone-toggle'));
initMIDI(statusEl, DRUM);

const runner = createTestRunner({
  tests: TESTS,
  types: TYPES,
  firmwareMin: FIRMWARE_MIN_VERSION,
  faceplateEls,
  onReset: muteTone,
  listEl: document.getElementById('test-list'),
  statusEl,
});

document.addEventListener('midi-cc', e => {
  if (e.detail.cc === TONE_PITCH_CC) setToneCC(e.detail.value);
});

document.addEventListener('midi-note-on', e => {
  const { note, velocity } = e.detail;
  let touched = false;
  for (const [t, m] of runner.each('pad')) {
    if (velocity < PAD_VELOCITY_MIN || NOTE_CONTROLS[note]?.track !== t.track) continue;
    m.hits++;
    touched = true;
  }
  for (const [, m] of runner.each('notes')) {
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
  if (touched) runner.render();
});

document.addEventListener('midi-sequencer-state', e => {
  const on = e.detail.stepVelocities.slice(0, SEQ_TRACKS * SEQ_STEPS).map(v => v > 0);
  for (const [, m] of runner.each('sequencer')) {
    m.current = on;
    on.forEach((lit, i) => { if (lit) m.seenOn[i] = true; else m.seenOff[i] = true; });
  }
  runner.render();
});
