/**
 * controls.js
 * DUO MIDI → SVG element mapping. Pure data, no DOM access.
 * Control types are applied by applyCC() in shared/js/faceplate.js.
 *
 * Only the synth side sends CCs (see duo/firmware/MidiFunctions.h). Pots are
 * sent as their 10-bit reading >> 3; the four buttons are momentary: 127 while
 * held, 0 on release.
 */

// Sliders: travel is half the handle's range along the 550-unit track. The
// synth player sits at the top edge of the drawing, so pushing a slider away
// from them (towards CC 127) moves it down the drawing.
const SLIDER = { type: 'slider', dir: [0, 1], travel: 240 };

export const CC_CONTROLS = {
  7:  { id: 'knob-amp',       type: 'knob',   label: 'Amp' },
  65: { id: 'btn-glide',      type: 'button', label: 'Glide' },
  70: { id: 'slider-wave',    ...SLIDER,      label: 'Wave' },
  71: { id: 'knob-res',       type: 'knob',   label: 'Res' },
  72: { id: 'slider-release', ...SLIDER,      label: 'Release' },
  74: { id: 'slider-freq',    ...SLIDER,      label: 'Freq' },
  80: { id: 'btn-delay',      type: 'button', label: 'Delay' },
  81: { id: 'btn-crush',      type: 'button', label: 'Crush' },
  94: { id: 'knob-detune',    type: 'knob',   label: 'Detune' },
};

// Sequencer-side knobs have no CC; test.js derives their position from MIDI
// clock (Speed) and note length (Length) and moves them with these.
export const SPEED_KNOB = { id: 'knob-speed', type: 'knob' };
export const LENGTH_KNOB = { id: 'knob-length', type: 'knob' };

/**
 * Keyboard: the note each key plays when untransposed (firmware SCALE), left
 * to right as key-0 … key-9. Sequencer notes are drawn from the same scale.
 */
export const KEY_NOTES = [49, 51, 54, 56, 58, 61, 63, 66, 68, 70];
export const KEY_IDS = KEY_NOTES.map((_, i) => `key-${i}`);
