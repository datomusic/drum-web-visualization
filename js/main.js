/**
 * main.js
 * Entry point. Wires MIDI and visualizer together.
 * Also handles the ?debug=1 overlay mode.
 */

import {
  initMIDI, setSetting, rebootToBootloader,
  SETTING_MIDI_CHANNEL, SETTING_SLIDER_MODE,
} from './midi.js';
import { initVisualizer } from './visualizer.js';

const statusEl = document.getElementById('midi-status');

initVisualizer();
initMIDI(statusEl);
initControlPanel();

// ---------------------------------------------------------------------------
// Control panel — MIDI channel, slider mode, reboot
// ---------------------------------------------------------------------------

function initControlPanel() {
  const channelSelect = document.getElementById('midi-channel');
  const paramBoxes = [...document.querySelectorAll('#control-panel input[name="param"]')];
  const rebootButton = document.getElementById('reboot-bootloader');
  const paramBits = { pitch: 1, gain: 2, decay: 4 };

  channelSelect.addEventListener('change', () => {
    setSetting(SETTING_MIDI_CHANNEL, parseInt(channelSelect.value, 10));
  });

  for (const box of paramBoxes) {
    box.addEventListener('change', () => {
      const mask = paramBoxes.reduce((m, b) => m | (b.checked ? paramBits[b.value] : 0), 0);
      setSetting(SETTING_SLIDER_MODE, mask);
    });
  }

  rebootButton.addEventListener('click', () => {
    if (confirm('Reboot the DRUM into USB bootloader mode?')) rebootToBootloader();
  });

  // Reflect device state (queried on connect) back into the UI.
  document.addEventListener('midi-setting', (e) => {
    const { id, value } = e.detail;
    if (id === SETTING_MIDI_CHANNEL) {
      channelSelect.value = String(value);
    } else if (id === SETTING_SLIDER_MODE) {
      for (const box of paramBoxes) {
        box.checked = (value & paramBits[box.value]) !== 0;
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Debug overlay — add ?debug=1 to the URL to show element IDs
// ---------------------------------------------------------------------------

if (new URLSearchParams(location.search).get('debug') === '1') {
  initDebugOverlay();
  initDebugMIDILog();
}

function initDebugMIDILog() {
  document.addEventListener('midi-cc',        e => console.log(`cc  ${e.detail.cc} = ${e.detail.value}`));
  document.addEventListener('midi-note-on',   e => console.log(`on  ${e.detail.note} v${e.detail.velocity}`));
  document.addEventListener('midi-note-off',  e => console.log(`off ${e.detail.note}`));
  document.addEventListener('midi-aftertouch',e => console.log(`at  ${e.detail.note} p${e.detail.pressure}`));
  document.addEventListener('midi-transport', e => console.log(`transport ${e.detail.type}`));
}

function initDebugOverlay() {
  const svg = document.querySelector('#visualization svg');
  if (!svg) return;

  // Collect all elements that have an id (excluding Artboard/clip)
  const skip = new Set(['Artboard1', '_clip1']);
  const labelled = svg.querySelectorAll('[id]');

  labelled.forEach(el => {
    const id = el.getAttribute('id');
    if (skip.has(id)) return;

    let x, y;
    try {
      const bbox = el.getBBox();
      x = bbox.x + bbox.width / 2;
      y = bbox.y + bbox.height / 2;
    } catch {
      return;
    }

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', x);
    text.setAttribute('y', y);
    text.setAttribute('class', 'debug-label');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.textContent = id;
    svg.appendChild(text);
  });

  // Inject debug label style into the SVG
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = `
    .debug-label {
      font: bold 28px sans-serif;
      fill: red;
      pointer-events: none;
    }
  `;
  svg.insertBefore(style, svg.firstChild);
}
