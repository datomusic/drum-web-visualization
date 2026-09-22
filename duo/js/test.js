/**
 * test.js
 * Entry point for duo/test.html — the DUO manufacturing production test.
 *
 * What the DUO reports over USB MIDI (duo-imxrt firmware, brains 2):
 *   - CCs for the synth side: 6 pots/sliders + Crush, Delay, Glide (momentary)
 *   - note on/off for every note it plays (keyboard and sequencer), velocity
 *     100, or 127 while Accent is held; transpose shifts the note numbers
 *   - Continue / Stop when the play button starts / stops the sequencer
 *   - MIDI clock, always, at the tempo set by Speed (30–603 BPM)
 *   - note length (gate) set by Length (10–200 ms)
 *   - firmware version and serial number on request (SysEx)
 * Random, Boost and the 8 step buttons send nothing of their own, so they are
 * not in this test.
 */

import { initMIDI } from '../../shared/js/midi.js';
import { applyCC } from '../../shared/js/faceplate.js';
import { createTestRunner, setElState, CC_MAX, REST_CENTER, REST_LOW } from '../../shared/js/test-runner.js';
import { DUO, resetTranspose } from './device.js';
import { initVisualizer } from './visualizer.js';
import { CC_CONTROLS, KEY_NOTES, KEY_IDS, SPEED_KNOB, LENGTH_KNOB } from './controls.js';

// Minimum firmware version required to pass the firmware test (current brains 2 release).
const FIRMWARE_MIN_VERSION = '1.2.0';

const NOTE_VELOCITY = 100;   // every note the sequencer/keyboard plays
const ACCENT_VELOCITY = 127; // while Accent is held
const LOWEST_KEY = KEY_NOTES[0];
const HIGHEST_KEY = KEY_NOTES.at(-1);

// Speed: tempo is measured from MIDI clock (24 per beat). USB delivers the
// pulses in bursts (0–16 ms apart at a steady 600 BPM), so the period is a
// least-squares fit over the last CLOCK_WINDOW_MS, used once the pulses span
// at least CLOCK_MIN_SPAN_MS.
const CLOCK_PPQN = 24;
const CLOCK_WINDOW_MS = 1000;
const CLOCK_MIN_SPAN_MS = 600;
const CLOCK_MIN_PULSES = 4;

// Length: note length is measured while the sequencer runs. A note cut short
// by the next note (off and on in the same instant) shows the step length or a
// retrigger, not the gate, so it is ignored.
const NOTE_CUT_MS = 3;
const NOTE_SETTLE_MS = 20;
const GATE_MIN_MS = 10;
const GATE_MAX_MS = 200;

/**
 * Tempo pot (0–1023) → clock period, copied from the firmware (tempo.cpp):
 * three linear segments of the period, 30–60, 60–200 and 200–603 BPM.
 */
const period = bpm => 2500000 / bpm;
const TEMPO_SEGMENTS = [ // [pot from, pot to, period from, period to]
  [0, 128, period(30), period(60)],
  [128, 895, period(60), period(200)],
  [895, 1023, period(200), period(603)],
];

function bpmToPot(bpm) {
  const p = period(bpm);
  const seg = TEMPO_SEGMENTS.find(([, , , p1]) => p >= p1) ?? TEMPO_SEGMENTS.at(-1);
  const [pot0, pot1, p0, p1] = seg;
  return pot0 + (p - p0) / (p1 - p0) * (pot1 - pot0);
}

function potToBpm(pot) {
  const [pot0, pot1, p0, p1] = TEMPO_SEGMENTS.find(([, to]) => pot <= to) ?? TEMPO_SEGMENTS.at(-1);
  return 2500000 / (p0 + (pot - pot0) / (pot1 - pot0) * (p1 - p0));
}

/** A 10-bit pot reading as the 0–127 value the runner works in (like the CCs: >> 3). */
const potToCC = pot => Math.max(0, Math.min(CC_MAX, Math.floor(pot / 8)));
const ccToPot = cc => cc / CC_MAX * 1023; // for display: 0 and 127 land on the pot's ends

const gateToPot = ms => (ms - GATE_MIN_MS) / (GATE_MAX_MS - GATE_MIN_MS) * 1023;
const potToGate = pot => GATE_MIN_MS + pot / 1023 * (GATE_MAX_MS - GATE_MIN_MS);

/**
 * Ordered list of tests. Types beyond the runner's built-in 'firmware',
 * 'serial' and 'cc' (see test-runner.js):
 *   'accent'    — a note arrived with velocity 127, and the last note is back to 100
 *   'keys'      — every key's note has been heard while the sequencer was stopped
 *   'transpose' — a note above the highest key (↑) and below the lowest key (↓) was heard
 *   'play'      — the sequencer was started and stopped, and is left stopped
 * 'speed' and 'length' are 'cc' tests fed with the pot position derived from
 * the measured tempo / note length.
 */
const TESTS = [
  { id: 'firmware', label: 'Firmware version', type: 'firmware' },
  { id: 'serial',   label: 'Serial number',    type: 'serial' },
  { id: 'release',  label: 'Release',  type: 'cc', cc: 72, rest: REST_CENTER },
  { id: 'freq',     label: 'Freq',     type: 'cc', cc: 74, rest: REST_CENTER },
  { id: 'wave',     label: 'Wave',     type: 'cc', cc: 70, rest: REST_CENTER },
  { id: 'res',      label: 'Res',      type: 'cc', cc: 71, rest: REST_CENTER },
  { id: 'amp',      label: 'Amp',      type: 'cc', cc: 7,  rest: REST_CENTER },
  { id: 'detune',   label: 'Detune',   type: 'cc', cc: 94, rest: REST_CENTER },
  { id: 'crush',    label: 'Crush',    type: 'cc', cc: 81, rest: REST_LOW, half: true },
  { id: 'delay',    label: 'Delay',    type: 'cc', cc: 80, rest: REST_LOW, half: true },
  { id: 'glide',    label: 'Glide',    type: 'cc', cc: 65, rest: REST_LOW, half: true },
  { id: 'accent',   label: 'Accent',   type: 'accent', half: true },
  { id: 'speed',    label: 'Speed',    type: 'cc', rest: REST_CENTER, knob: SPEED_KNOB,
    unit: 'BPM',
    format: cc => Math.round(potToBpm(ccToPot(cc))) },
  { id: 'length',   label: 'Length',   type: 'cc', rest: REST_CENTER, knob: LENGTH_KNOB,
    unit: 'ms',
    format: cc => Math.round(potToGate(ccToPot(cc))) },
  { id: 'keys',     label: 'Keyboard', type: 'keys' },
  { id: 'transpose', label: 'Transpose', type: 'transpose', half: true },
  { id: 'play',     label: 'Play',     type: 'play', half: true },
];

/** SVG elements that show a 'cc' test's state. */
function faceplateEls(t) {
  const ctrl = t.knob ?? CC_CONTROLS[t.cc];
  if (!ctrl) return [];
  return [ctrl.id, ctrl.type === 'slider' && `${ctrl.id}-track`]
    .filter(Boolean)
    .map(id => document.getElementById(id))
    .filter(Boolean);
}

// Sequencer transport, as last reported by the DUO. It is sent Stop on connect.
let running = false;

const mark = (ok, seen) => ok ? 'test-done' : seen ? 'test-active' : 'test-idle';

const TYPES = {
  accent: {
    init: () => ({ accented: false, lastVelocity: null }),
    passed: (t, m) => m.accented && m.lastVelocity !== null && m.lastVelocity < ACCENT_VELOCITY,
    fill: (t, m) => [0, m.accented ? 1 : 0],
    faceplate: (t, m, passed) => setElState(document.getElementById('btn-accent'), mark(passed, m.lastVelocity !== null)),
    detail: (t, m) => {
      if (m.lastVelocity === null) return '—';
      const last = m.lastVelocity < ACCENT_VELOCITY ? `${m.lastVelocity} ✓` : `${m.lastVelocity} → ${NOTE_VELOCITY}`;
      return `${ACCENT_VELOCITY} ${m.accented ? '✓' : '·'}   ·   ${last}`;
    },
  },

  keys: {
    init: () => ({ heard: KEY_NOTES.map(() => false), last: null }),
    passed: (t, m) => m.heard.every(Boolean),
    fill: () => [0, 0],
    // One segment per key, filled once heard.
    background: (t, m, passed) => {
      if (passed) return '';
      const n = KEY_NOTES.length;
      const stops = m.heard.map((h, i) =>
        `${h ? 'var(--color-light-blue)' : 'var(--color-gray)'} ${(i / n) * 100}% ${((i + 1) / n) * 100}%`);
      return `linear-gradient(to right, ${stops.join(', ')})`;
    },
    cursor: (t, m) => m.last === null ? null : (m.last + 0.5) / KEY_NOTES.length,
    faceplate: (t, m) => {
      m.heard.forEach((h, i) => setElState(document.getElementById(KEY_IDS[i]), mark(h, m.last !== null)));
    },
    detail: (t, m) => {
      const parts = [`${m.heard.filter(Boolean).length} / ${KEY_NOTES.length} keys`];
      if (running && !m.heard.every(Boolean)) parts.push('stop the sequencer to test keys');
      return parts.join('   ·   ');
    },
  },

  transpose: {
    init: () => ({ up: false, down: false }),
    passed: (t, m) => m.up && m.down,
    fill: (t, m) => [0, (m.up + m.down) / 2],
    faceplate: (t, m) => {
      setElState(document.getElementById('arrow-up'), mark(m.up, m.down));
      setElState(document.getElementById('arrow-down'), mark(m.down, m.up));
    },
    detail: (t, m) => `↑${m.up ? '✓' : '·'} ↓${m.down ? '✓' : '·'}`,
  },

  play: {
    init: () => ({ started: false, stopped: false }),
    passed: (t, m) => m.started && m.stopped && !running,
    fill: (t, m) => [0, (m.started + m.stopped) / 2],
    faceplate: (t, m, passed) => setElState(document.getElementById('play-outer'), mark(passed, m.started)),
    detail: (t, m) => {
      if (!m.started) return '—';
      return [`start ✓`, `stop ${m.stopped ? '✓' : '·'}`, running ? 'running → stop' : 'stopped ✓'].join('   ·   ');
    },
  },
};

// ---------------------------------------------------------------------------

const statusEl = document.getElementById('midi-status');

initVisualizer();
initMIDI(statusEl, DUO);

// Measurement state, cleared with the test list
let clockTimes = [];
let speedCC = null;
let noteOn = null;       // { time } of the sounding note, while the sequencer runs
let pendingGate = null;  // { ms, time } waiting to see whether the next note cut it

const runner = createTestRunner({
  tests: TESTS,
  types: TYPES,
  firmwareMin: FIRMWARE_MIN_VERSION,
  faceplateEls,
  onReset: () => {
    running = false;
    clockTimes = [];
    speedCC = null;
    noteOn = null;
    pendingGate = null;
  },
  listEl: document.getElementById('test-list'),
  statusEl,
});

/** Feed a derived pot position to its test and turn the drawn knob to match. */
function observeKnob(id, cc) {
  runner.observe(id, cc);
  applyCC(TESTS.find(t => t.id === id).knob, cc);
}

/** Clock period (ms) as the slope of a least-squares line through pulse index → time. */
function clockPeriod(times) {
  const n = times.length;
  const meanI = (n - 1) / 2;
  const meanT = times.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  times.forEach((t, i) => { num += (i - meanI) * (t - meanT); den += (i - meanI) ** 2; });
  return num / den;
}

// Speed: clock period over the last CLOCK_WINDOW_MS.
document.addEventListener('midi-clock', e => {
  const now = e.detail.time;
  clockTimes.push(now);
  while (clockTimes.length && clockTimes[0] < now - CLOCK_WINDOW_MS) clockTimes.shift();
  if (clockTimes.length < CLOCK_MIN_PULSES || now - clockTimes[0] < CLOCK_MIN_SPAN_MS) return;
  const interval = clockPeriod(clockTimes);
  const cc = potToCC(bpmToPot(60000 / (interval * CLOCK_PPQN)));
  if (cc === speedCC) return;
  speedCC = cc;
  observeKnob('speed', cc);
});

document.addEventListener('midi-transport', e => {
  running = e.detail.type !== 'stop';
  for (const [, m] of runner.each('play')) {
    if (running) m.started = true;
    else if (m.started) m.stopped = true;
  }
  runner.render();
});

document.addEventListener('midi-note-on', e => {
  const { note, velocity, time } = e.detail;

  // Length: a note that was cut off by this one doesn't count.
  if (pendingGate && time - pendingGate.time < NOTE_CUT_MS) pendingGate = null;
  noteOn = running ? { time } : null;

  for (const [, m] of runner.each('accent')) {
    if (velocity >= ACCENT_VELOCITY) m.accented = true;
    m.lastVelocity = velocity;
  }

  // Keys: only while stopped, since the running sequencer plays scale notes by itself.
  const key = KEY_NOTES.indexOf(note);
  if (key >= 0 && !running) {
    for (const [, m] of runner.each('keys')) {
      m.heard[key] = true;
      m.last = key;
    }
  }

  for (const [, m] of runner.each('transpose')) {
    const wasPassed = m.up && m.down;
    if (note > HIGHEST_KEY) m.up = true;
    if (note < LOWEST_KEY) m.down = true;
    // Done: put the keyboard back on the plain scale for the key test.
    if (m.up && m.down && !wasPassed) resetTranspose();
  }

  runner.render();
});

document.addEventListener('midi-note-off', e => {
  const { time } = e.detail;
  if (!noteOn) return;
  const gate = { ms: time - noteOn.time, time };
  noteOn = null;
  pendingGate = gate;
  setTimeout(() => {
    if (pendingGate !== gate) return;
    pendingGate = null;
    observeKnob('length', potToCC(gateToPot(gate.ms)));
  }, NOTE_SETTLE_MS);
});
