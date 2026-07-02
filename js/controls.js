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
  21: { id: 'pitch-slider-2', type: 'slider', indicatorId: 'pitch-indicator-2', label: 'Pitch 1', dir: [-0.707, 0.707], travel: 84.85 },
  22: { id: 'pitch-slider-3', type: 'slider', indicatorId: 'pitch-indicator-3', label: 'Pitch 2', dir: [-0.707, -0.707], travel: 84.85 },
  23: { id: 'pitch-slider-4', type: 'slider', indicatorId: 'pitch-indicator-4', label: 'Pitch 3', dir: [0.707, -0.707], travel: 84.85 },
  24: { id: 'pitch-slider-1', type: 'slider', indicatorId: 'pitch-indicator-1', label: 'Pitch 4', dir: [0.707, 0.707], travel: 84.85 },
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
  30: { padId: 'drumpad-1', track: 1, sample: 1, color: '#FF0040' },
  31: { padId: 'drumpad-1', track: 1, sample: 2, color: '#FF0060' },
  32: { padId: 'drumpad-1', track: 1, sample: 3, color: '#FF1010' },
  33: { padId: 'drumpad-1', track: 1, sample: 4, color: '#FF1020' },
  34: { padId: 'drumpad-1', track: 1, sample: 5, color: '#FF2040' },
  35: { padId: 'drumpad-1', track: 1, sample: 6, color: '#FF2060' },
  36: { padId: 'drumpad-1', track: 1, sample: 7, color: '#FF0000' },
  37: { padId: 'drumpad-1', track: 1, sample: 8, color: '#FF0020' },
  // Track 2
  38: { padId: 'drumpad-2', track: 2, sample: 1, color: '#0000FF' },
  39: { padId: 'drumpad-2', track: 2, sample: 2, color: '#0028FF' },
  40: { padId: 'drumpad-2', track: 2, sample: 3, color: '#0050FF' },
  41: { padId: 'drumpad-2', track: 2, sample: 4, color: '#0078FF' },
  42: { padId: 'drumpad-2', track: 2, sample: 5, color: '#1010FF' },
  43: { padId: 'drumpad-2', track: 2, sample: 6, color: '#1028FF' },
  44: { padId: 'drumpad-2', track: 2, sample: 7, color: '#2050FF' },
  45: { padId: 'drumpad-2', track: 2, sample: 8, color: '#3078FF' },
  // Track 3
  46: { padId: 'drumpad-3', track: 3, sample: 1, color: '#00FF00' },
  47: { padId: 'drumpad-3', track: 3, sample: 2, color: '#00FF1E' },
  48: { padId: 'drumpad-3', track: 3, sample: 3, color: '#00FF3C' },
  49: { padId: 'drumpad-3', track: 3, sample: 4, color: '#00FF5A' },
  50: { padId: 'drumpad-3', track: 3, sample: 5, color: '#10FF10' },
  51: { padId: 'drumpad-3', track: 3, sample: 6, color: '#10FF1E' },
  52: { padId: 'drumpad-3', track: 3, sample: 7, color: '#10FF3C' },
  53: { padId: 'drumpad-3', track: 3, sample: 8, color: '#20FF5A' },
  // Track 4
  54: { padId: 'drumpad-4', track: 4, sample: 1, color: '#FFFF00' },
  55: { padId: 'drumpad-4', track: 4, sample: 2, color: '#FFE100' },
  56: { padId: 'drumpad-4', track: 4, sample: 3, color: '#FFC300' },
  57: { padId: 'drumpad-4', track: 4, sample: 4, color: '#FFA500' },
  58: { padId: 'drumpad-4', track: 4, sample: 5, color: '#FFFF20' },
  59: { padId: 'drumpad-4', track: 4, sample: 6, color: '#FFE120' },
  60: { padId: 'drumpad-4', track: 4, sample: 7, color: '#FFC320' },
  61: { padId: 'drumpad-4', track: 4, sample: 8, color: '#FFA520' },
};

/**
 * Sequencer step LED IDs in order (step-00..step-31).
 * The exact track↔LED mapping is TBD — verify with device + debug overlay.
 * Update TRACK_STEP_MAP once the physical layout is confirmed.
 */
export const STEP_LED_IDS = Array.from({ length: 32 }, (_, i) => `step-${String(i).padStart(2, '0')}`);

/**
 * Track → step LED index range.
 * Maps firmware track index (0–3) to inclusive [start, end] in STEP_LED_IDS.
 * Firmware payload: bytes 0–7 = track 0, 8–15 = track 1, 16–23 = track 2, 24–31 = track 3.
 * Ring 0 (outermost, step-00..step-07) = track 0, etc. Verify with device.
 */
export const TRACK_STEP_MAP = {
  1: [0, 7],   // Track 1 maps to outermost ring (Kick / Red)
  2: [8, 15],  // Track 2 maps to mid-outer ring (Snare / Blue)
  3: [16, 23], // Track 3 maps to mid-inner ring (Clap / Green)
  4: [24, 31], // Track 4 maps to innermost ring (Hat / Yellow)
};

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
