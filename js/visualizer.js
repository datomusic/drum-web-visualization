/**
 * visualizer.js
 * Maps MIDI events to SVG DOM updates (CSS classes + transforms).
 * Listens for CustomEvents dispatched by midi.js.
 */

import { CC_CONTROLS, NOTE_CONTROLS, STEP_LED_IDS, TRACK_STEP_MAP, ccToRotation, ccToTranslation } from './controls.js';

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
  document.addEventListener('midi-cc',               e => handleCC(e.detail));
  document.addEventListener('midi-note-on',          e => handleNoteOn(e.detail));
  document.addEventListener('midi-note-off',         e => handleNoteOff(e.detail));
  document.addEventListener('midi-clock',            () => handleClock());
  document.addEventListener('midi-transport',        e => handleTransport(e.detail));
  document.addEventListener('midi-sequencer-state',  e => handleSequencerState(e.detail));
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
    if (el) el.dataset.ccValue = value;
    const rotTarget = ctrl.indicatorId
      ? document.getElementById(ctrl.indicatorId)
      : el;
    if (rotTarget) {
      const bbox = rotTarget.getBBox();
      const cx = bbox.x + bbox.width / 2;
      const cy = bbox.y + bbox.height / 2;
      rotTarget.style.transformOrigin = `${cx}px ${cy}px`;
      rotTarget.style.transform = `rotate(${deg}deg)`;
    }

  } else if (ctrl.type === 'slider') {
    const offset = ccToTranslation(value, ctrl.travel);
    const tx = offset * ctrl.dir[0];
    const ty = offset * ctrl.dir[1];
    const transform = `translate(${tx}px, ${ty}px)`;
    const indicator = document.getElementById(ctrl.indicatorId);
    if (indicator) indicator.style.transform = transform;
    if (el) el.style.transform = transform;

  }
}

// ---------------------------------------------------------------------------
// Note handlers
// ---------------------------------------------------------------------------

function handleNoteOn({ note, velocity }) {
  const ctrl = NOTE_CONTROLS[note];
  if (!ctrl) return;

  const pad = document.getElementById(ctrl.padId);
  if (!pad) return;

  // Dynamic pad color update on hit (based on note definition color)
  if (ctrl.color) {
    const path = pad.querySelector('path');
    if (path) {
      path.style.fill = ctrl.color;
    }
  }

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

// ---------------------------------------------------------------------------
// Sequencer state
// ---------------------------------------------------------------------------

function handleSequencerState({ stepVelocities }) {
  // 1. Extract active note colors (bytes 32-35)
  const activeNoteColors = {};
  if (stepVelocities.length >= 36) {
    const activeNotes = stepVelocities.slice(32);
    activeNotes.forEach((note) => {
      const ctrl = NOTE_CONTROLS[note];
      if (ctrl && ctrl.color) {
        // Store color mapped by its logical 1-based track number (1-4)
        activeNoteColors[ctrl.track] = ctrl.color;
        // Update pad color as well
        const pad = document.getElementById(ctrl.padId);
        if (pad) {
          const path = pad.querySelector('path');
          if (path) {
            path.style.fill = ctrl.color;
          }
        }
      }
    });
  }

  // 2. Update step LEDs (setting track colors on lit steps)
  let found = 0, missing = 0;
  for (const [trackStr, [start, end]] of Object.entries(TRACK_STEP_MAP)) {
    const track = parseInt(trackStr, 10); // track is 1-based (1-4)
    const trackColor = activeNoteColors[track];

    for (let step = 0; step <= end - start; step++) {
      const id = STEP_LED_IDS[start + step];
      const el = document.getElementById(id);
      if (!el) { missing++; if (missing === 1) console.warn(`sequencer: element not found: "${id}"`); continue; }
      found++;
      
      // Read step velocities from 0-based array index (track - 1)
      const isLit = stepVelocities[(track - 1) * 8 + step] > 0;
      el.classList.toggle('lit', isLit);
      if (isLit && trackColor) {
        el.style.fill = trackColor;
      } else {
        el.style.fill = '';
      }
    }
  }

  console.log(`sequencer: updated ${found} LEDs, ${missing} missing`);
}
