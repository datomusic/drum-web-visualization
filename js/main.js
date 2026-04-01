/**
 * main.js
 * Entry point. Wires MIDI and visualizer together.
 * Also handles the ?debug=1 overlay mode.
 */

import { initMIDI } from './midi.js';
import { initVisualizer } from './visualizer.js';

const statusEl = document.getElementById('midi-status');

initVisualizer();
initMIDI(statusEl);

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
