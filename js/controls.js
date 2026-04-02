/**
 * controls.js
 * MIDI → SVG element mapping definitions.
 * This is the pure data layer — no DOM access here.
 */

// MIDI channel the device uses (0-indexed, so channel 10 = index 9)
export const MIDI_CHANNEL = 9;

/**
 * CC number → control descriptor
 * type:
 *   'button'  — lights up when value > 0, off at 0
 *   'knob'    — rotates its indicator element based on value 0-127
 *   'slider'  — translates both id and indicatorId along dir by travel SVG units
 *   'display' — custom visual (swing bars, etc.)
 */
export const CC_CONTROLS = {
  7: { id: 'knob-volume', type: 'knob', indicatorId: null, label: 'Volume' },
  9: { id: 'slider-swing', type: 'slider', indicatorId: null, label: 'Swing', dir: [0, 1], travel: 25 },
  12: { id: 'btn-crush', type: 'button', indicatorId: null, label: 'Crush', pressure: true },
  15: { id: 'knob-tempo', type: 'knob', indicatorId: null, label: 'Tempo' },
  16: { id: 'btn-random', type: 'button', indicatorId: null, label: 'Random', pressure: true },
  17: { id: 'btn-repeat', type: 'button', indicatorId: null, label: 'Repeat', pressure: true },
  // Pitch sliders: dir is the unit vector toward CC 127 (outward from device center)
  // travel is half the pill length in SVG user units (169.7 / 2)
  21: { id: 'pitch-knob-2', type: 'slider', indicatorId: 'pitch-indicator-2', label: 'Pitch 1', dir: [-0.707, 0.707], travel: 84.85 },
  22: { id: 'pitch-knob-3', type: 'slider', indicatorId: 'pitch-indicator-3', label: 'Pitch 2', dir: [-0.707, -0.707], travel: 84.85 },
  23: { id: 'pitch-knob-4', type: 'slider', indicatorId: 'pitch-indicator-4', label: 'Pitch 3', dir: [0.707, -0.707], travel: 84.85 },
  24: { id: 'pitch-knob-1', type: 'slider', indicatorId: 'pitch-indicator-1', label: 'Pitch 4', dir: [0.707, 0.707], travel: 84.85 },
  74: { id: 'btn-filter', type: 'button', indicatorId: null, label: 'Filter', pressure: true },
  75: { id: 'knob-resonance', type: 'knob', indicatorId: null, label: 'Resonance' },
};

/**
 * MIDI note → pad descriptor
 * track: 1-4
 * sample: 1-8
 */
export const NOTE_CONTROLS = {
  // Track 1
  30: { padId: 'drumpad-1', track: 1, sample: 1 },
  31: { padId: 'drumpad-1', track: 1, sample: 2 },
  32: { padId: 'drumpad-1', track: 1, sample: 3 },
  33: { padId: 'drumpad-1', track: 1, sample: 4 },
  34: { padId: 'drumpad-1', track: 1, sample: 5 },
  35: { padId: 'drumpad-1', track: 1, sample: 6 },
  36: { padId: 'drumpad-1', track: 1, sample: 7 },
  37: { padId: 'drumpad-1', track: 1, sample: 8 },
  // Track 2
  38: { padId: 'drumpad-2', track: 2, sample: 1 },
  39: { padId: 'drumpad-2', track: 2, sample: 2 },
  40: { padId: 'drumpad-2', track: 2, sample: 3 },
  41: { padId: 'drumpad-2', track: 2, sample: 4 },
  42: { padId: 'drumpad-2', track: 2, sample: 5 },
  43: { padId: 'drumpad-2', track: 2, sample: 6 },
  44: { padId: 'drumpad-2', track: 2, sample: 7 },
  45: { padId: 'drumpad-2', track: 2, sample: 8 },
  // Track 3
  46: { padId: 'drumpad-3', track: 3, sample: 1 },
  47: { padId: 'drumpad-3', track: 3, sample: 2 },
  48: { padId: 'drumpad-3', track: 3, sample: 3 },
  49: { padId: 'drumpad-3', track: 3, sample: 4 },
  50: { padId: 'drumpad-3', track: 3, sample: 5 },
  51: { padId: 'drumpad-3', track: 3, sample: 6 },
  52: { padId: 'drumpad-3', track: 3, sample: 7 },
  53: { padId: 'drumpad-3', track: 3, sample: 8 },
  // Track 4
  54: { padId: 'drumpad-4', track: 4, sample: 1 },
  55: { padId: 'drumpad-4', track: 4, sample: 2 },
  56: { padId: 'drumpad-4', track: 4, sample: 3 },
  57: { padId: 'drumpad-4', track: 4, sample: 4 },
  58: { padId: 'drumpad-4', track: 4, sample: 5 },
  59: { padId: 'drumpad-4', track: 4, sample: 6 },
  60: { padId: 'drumpad-4', track: 4, sample: 7 },
  61: { padId: 'drumpad-4', track: 4, sample: 8 },
};

/**
 * Sequencer step LED IDs in order (step-00..step-39).
 * The exact track↔LED mapping is TBD — verify with device + debug overlay.
 * Update TRACK_STEP_MAP once the physical layout is confirmed.
 */
export const STEP_LED_IDS = Array.from({ length: 40 }, (_, i) => `step-${String(i).padStart(2, '0')}`);

/**
 * Track → step LED index range (TBD — fill in after device verification).
 * Example: { 1: [0, 9], 2: [10, 19], 3: [20, 29], 4: [30, 39] }
 */
export const TRACK_STEP_MAP = null; // set once confirmed

/**
 * Map a CC value (0-127) to a CSS rotation angle in degrees.
 * 0 → -135°, 64 → 0°, 127 → +135°
 */
export function ccToRotation(value) {
  return ((value / 127) * 270) - 135;
}

/**
 * Map a CC value (0-127) to a signed translation offset in SVG user units.
 * 0 → -travel, 64 → ~0, 127 → +travel
 * Multiply by ctrl.dir to get (tx, ty).
 */
export function ccToTranslation(value, travel) {
  return ((value / 127) * 2 - 1) * travel;
}
