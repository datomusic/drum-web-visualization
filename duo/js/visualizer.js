/**
 * visualizer.js
 * Live DUO faceplate: moves knobs/sliders, shows held buttons, flashes keys
 * and lights the play button while the sequencer runs.
 */

import { applyCC } from '../../shared/js/faceplate.js';
import { CC_CONTROLS, KEY_NOTES, KEY_IDS } from './controls.js';

// Duration a key stays lit after its note (ms)
const HIT_DURATION_MS = 120;

export function initVisualizer() {
  document.addEventListener('midi-cc', e => {
    const ctrl = CC_CONTROLS[e.detail.cc];
    if (ctrl) applyCC(ctrl, e.detail.value);
  });

  document.addEventListener('midi-note-on', e => {
    const i = KEY_NOTES.indexOf(e.detail.note);
    const key = i >= 0 && document.getElementById(KEY_IDS[i]);
    if (!key) return;
    key.classList.add('hit');
    clearTimeout(key._hitTimer);
    key._hitTimer = setTimeout(() => key.classList.remove('hit'), HIT_DURATION_MS);
  });

  const setPlaying = on => document.getElementById('play-outer')?.classList.toggle('playing', on);
  document.addEventListener('midi-transport', e => setPlaying(e.detail.type !== 'stop'));
  document.addEventListener('midi-connected', () => setPlaying(false));
  document.addEventListener('midi-disconnected', () => setPlaying(false));
}
