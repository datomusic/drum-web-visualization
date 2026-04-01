/**
 * visualizer.js
 * Maps MIDI events to SVG DOM updates (CSS classes + transforms).
 * Listens for CustomEvents dispatched by midi.js.
 */

import { CC_CONTROLS, NOTE_CONTROLS, STEP_LED_IDS, ccToRotation, ccToTranslation } from './controls.js';

// Duration a pad stays "lit" after a hit (ms)
const HIT_DURATION_MS = 120;

// MIDI clock pulses per quarter note (PPQN)
const PPQN = 24;
// Pulses per step (assumes 1 step = 1 sixteenth note = PPQN/4)
const PULSES_PER_STEP = PPQN / 4;

let clockPulse = 0;
let currentStep = 0;
let isPlaying = false;

export function initVisualizer() {
  document.addEventListener('midi-cc',        e => handleCC(e.detail));
  document.addEventListener('midi-note-on',   e => handleNoteOn(e.detail));
  document.addEventListener('midi-note-off',  e => handleNoteOff(e.detail));
  document.addEventListener('midi-clock',     () => handleClock());
  document.addEventListener('midi-transport', e => handleTransport(e.detail));
}

// ---------------------------------------------------------------------------
// CC handler
// ---------------------------------------------------------------------------

function handleCC({ cc, value }) {
  const ctrl = CC_CONTROLS[cc];
  if (!ctrl) return;

  const el = document.getElementById(ctrl.id);

  if (ctrl.type === 'button') {
    if (ctrl.pressure && el) {
      el.style.setProperty('--cc-pressure', value / 127);
    }
    el?.classList.toggle('pressed', value > 0);

  } else if (ctrl.type === 'knob') {
    const deg = ccToRotation(value);
    // Store as a data attribute so CSS can read it, and rotate the indicator
    if (el) el.dataset.ccValue = value;
    if (ctrl.indicatorId) {
      const indicator = document.getElementById(ctrl.indicatorId);
      if (indicator) {
        // Use the bounding box centre as the rotation origin
        const bbox = indicator.getBBox();
        const cx = bbox.x + bbox.width / 2;
        const cy = bbox.y + bbox.height / 2;
        indicator.style.transformOrigin = `${cx}px ${cy}px`;
        indicator.style.transform = `rotate(${deg}deg)`;
      }
    }

  } else if (ctrl.type === 'slider') {
    const offset = ccToTranslation(value, ctrl.travel);
    const tx = offset * ctrl.dir[0];
    const ty = offset * ctrl.dir[1];
    const transform = `translate(${tx}px, ${ty}px)`;
    const indicator = document.getElementById(ctrl.indicatorId);
    if (indicator) indicator.style.transform = transform;
    if (el) el.style.transform = transform;

  } else if (ctrl.type === 'display' && cc === 9) {
    // Swing: light up bars proportionally
    updateSwingBars(value);
  }
}

function updateSwingBars(value) {
  // 3 bars, each representing ~42 units of the 0-127 range
  const thresholds = [42, 85, 127];
  thresholds.forEach((threshold, i) => {
    const bar = document.getElementById(`swing-bar-${i}`);
    bar?.classList.toggle('active', value > threshold - 1);
  });
}

// ---------------------------------------------------------------------------
// Note handlers
// ---------------------------------------------------------------------------

function handleNoteOn({ note, velocity }) {
  const ctrl = NOTE_CONTROLS[note];
  if (!ctrl) return;

  const pad = document.getElementById(ctrl.padId);
  if (!pad) return;

  // Intensity via CSS custom property (0-127)
  pad.style.setProperty('--hit-velocity', velocity);
  pad.classList.add('hit');
  clearTimeout(pad._hitTimer);
  pad._hitTimer = setTimeout(() => pad.classList.remove('hit'), HIT_DURATION_MS);
}

function handleNoteOff({ note }) {
  // Note off is ignored per the device spec, but clear any lingering state
  const ctrl = NOTE_CONTROLS[note];
  if (!ctrl) return;
  const pad = document.getElementById(ctrl.padId);
  pad?.classList.remove('held');
}

// ---------------------------------------------------------------------------
// Clock & transport
// ---------------------------------------------------------------------------

function handleClock() {
  if (!isPlaying) return;

  clockPulse++;
  if (clockPulse % PULSES_PER_STEP === 0) {
    advanceStep();
  }
}

function advanceStep() {
  // Turn off current step LED
  const prev = document.getElementById(STEP_LED_IDS[currentStep]);
  prev?.classList.remove('active');

  currentStep = (currentStep + 1) % STEP_LED_IDS.length;

  // Turn on next step LED
  const next = document.getElementById(STEP_LED_IDS[currentStep]);
  next?.classList.add('active');
}

function handleTransport({ type }) {
  const playBtn = document.getElementById('play-outer');

  if (type === 'start' || type === 'continue') {
    isPlaying = true;
    clockPulse = 0;
    if (type === 'start') {
      currentStep = STEP_LED_IDS.length - 1; // will advance to 0 on first clock
      clearAllStepLEDs();
    }
    playBtn?.classList.add('playing');

  } else if (type === 'stop') {
    isPlaying = false;
    clearAllStepLEDs();
    playBtn?.classList.remove('playing');
  }
}

function clearAllStepLEDs() {
  for (const id of STEP_LED_IDS) {
    document.getElementById(id)?.classList.remove('active');
  }
}
