/**
 * tone.js
 * Sine wave generator for the line-in test (test.html).
 *
 * The browser's audio output is cabled to the DRUM's line input and judged by
 * ear — there is no measurement loop back into the computer, so this has no
 * entry in the test list. A speaker button toggles the tone; its frequency
 * follows the PITCH1 slider (see test.js). Starts muted, and is muted again
 * on every test reset.
 */

// CC 0–127 maps exponentially over TONE_OCTAVES from TONE_MIN_HZ (110 → 1760 Hz,
// A2 … A6), so the slider's center lands near 440 Hz and each step sounds like
// an equal interval.
const TONE_MIN_HZ = 110;
const TONE_OCTAVES = 4;
const TONE_GAIN = 0.5;
const RAMP_S = 0.02; // short fade in/out to avoid clicks on toggle

let ctx = null;
let gain = null;
let osc = null;
let buttonEl = null;
let frequency = TONE_MIN_HZ * 2 ** (TONE_OCTAVES * 64 / 127);
let playing = false;

/** Wire the toggle button. Audio is created lazily on the first click (user gesture). */
export function initTone(el) {
  buttonEl = el;
  buttonEl.addEventListener('click', () => setTonePlaying(!playing));
  updateButton();
}

/** Set the tone frequency from a 0–127 CC value. */
export function setToneCC(value) {
  frequency = TONE_MIN_HZ * 2 ** (TONE_OCTAVES * value / 127);
  if (osc) osc.frequency.setTargetAtTime(frequency, ctx.currentTime, 0.01);
}

export function muteTone() {
  setTonePlaying(false);
}

function setTonePlaying(on) {
  if (on && !ctx) createAudio();
  playing = on;
  if (ctx) {
    if (on && ctx.state === 'suspended') ctx.resume();
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setTargetAtTime(on ? TONE_GAIN : 0, ctx.currentTime, RAMP_S);
  }
  updateButton();
}

function createAudio() {
  ctx = new AudioContext();
  gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(ctx.destination);
  osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = frequency;
  osc.connect(gain);
  osc.start();
}

function updateButton() {
  if (!buttonEl) return;
  buttonEl.classList.toggle('muted', !playing);
  buttonEl.setAttribute('aria-pressed', String(playing));
  buttonEl.title = playing ? 'Mute sine wave' : 'Play sine wave (pitch: PITCH1 slider)';
}
