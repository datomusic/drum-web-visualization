/**
 * midi.js
 * Web MIDI API wrapper.
 * Parses incoming MIDI messages and dispatches typed CustomEvents on `document`.
 *
 * Events dispatched:
 *   'midi-cc'         detail: { channel, cc, value }
 *   'midi-note-on'    detail: { channel, note, velocity }
 *   'midi-note-off'   detail: { channel, note }
 *   'midi-aftertouch' detail: { channel, note, pressure }
 *   'midi-clock'      detail: {}
 *   'midi-transport'  detail: { type: 'start'|'continue'|'stop' }
 *   'midi-connected'  detail: { name }
 *   'midi-disconnected' detail: { name }
 */

export async function initMIDI(statusEl) {
  if (!navigator.requestMIDIAccess) {
    setStatus(statusEl, 'Web MIDI API not supported in this browser.');
    return;
  }

  let access;
  try {
    access = await navigator.requestMIDIAccess({ sysex: false });
  } catch (err) {
    setStatus(statusEl, `MIDI access denied: ${err.message}`);
    return;
  }

  function attachInputs() {
    let count = 0;
    for (const input of access.inputs.values()) {
      input.onmidimessage = onMessage;
      count++;
    }
    const names = [...access.inputs.values()].map(i => i.name).join(', ');
    setStatus(statusEl, count > 0 ? `Connected: ${names}` : 'No MIDI inputs found. Plug in the Dato DRUM.');
  }

  attachInputs();

  access.onstatechange = (e) => {
    const port = e.port;
    if (port.type !== 'input') return;
    if (port.state === 'connected') {
      port.onmidimessage = onMessage;
      setStatus(statusEl, `Connected: ${port.name}`);
      dispatch('midi-connected', { name: port.name });
    } else {
      setStatus(statusEl, `Disconnected: ${port.name}`);
      dispatch('midi-disconnected', { name: port.name });
    }
  };
}

function onMessage(e) {
  const [status, data1, data2] = e.data;
  const type = status & 0xF0;
  const channel = status & 0x0F;

  switch (status) {
    case 0xF8: // MIDI Clock
      dispatch('midi-clock', {});
      return;
    case 0xFA: // Start
      dispatch('midi-transport', { type: 'start' });
      return;
    case 0xFB: // Continue
      dispatch('midi-transport', { type: 'continue' });
      return;
    case 0xFC: // Stop
      dispatch('midi-transport', { type: 'stop' });
      return;
  }

  switch (type) {
    case 0x80: // Note Off
      dispatch('midi-note-off', { channel, note: data1 });
      break;
    case 0x90: // Note On
      if (data2 === 0) {
        dispatch('midi-note-off', { channel, note: data1 });
      } else {
        dispatch('midi-note-on', { channel, note: data1, velocity: data2 });
      }
      break;
    case 0xA0: // Polyphonic Aftertouch
      dispatch('midi-aftertouch', { channel, note: data1, pressure: data2 });
      break;
    case 0xB0: // Control Change
      dispatch('midi-cc', { channel, cc: data1, value: data2 });
      break;
  }
}

function dispatch(name, detail) {
  document.dispatchEvent(new CustomEvent(name, { detail }));
}

function setStatus(el, text) {
  if (el) el.textContent = text;
}
