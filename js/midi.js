/**
 * midi.js
 * Web MIDI API wrapper.
 * Parses incoming MIDI messages and dispatches typed CustomEvents on `document`.
 *
 * Events dispatched:
 *   'midi-cc'               detail: { channel, cc, value }
 *   'midi-note-on'          detail: { channel, note, velocity }
 *   'midi-note-off'         detail: { channel, note }
 *   'midi-aftertouch'       detail: { channel, note, pressure }
 *   'midi-clock'            detail: {}
 *   'midi-transport'        detail: { type: 'start'|'continue'|'stop' }
 *   'midi-sequencer-state'  detail: { stepVelocities: number[] } (36 bytes: 4 tracks × 8 steps + 4 active notes)
 *   'midi-connected'        detail: { name }
 *   'midi-disconnected'     detail: { name }
 */

// SysEx header: F0 + Dato manufacturer ID (00 22 01) + DRUM device ID (65)
const SYSEX_HEADER = [0xF0, 0x00, 0x22, 0x01, 0x65];
const TAG_SEQUENCER_STATE_REQUEST  = 0x30;
const TAG_SEQUENCER_STATE_RESPONSE = 0x31;

export async function initMIDI(statusEl) {
  if (!navigator.requestMIDIAccess) {
    setStatus(statusEl, 'Web MIDI API not supported in this browser.');
    return;
  }

  let access;
  try {
    access = await navigator.requestMIDIAccess({ sysex: true });
  } catch (err) {
    setStatus(statusEl, `MIDI access denied: ${err.message}`);
    return;
  }

  function requestSequencerState() {
    const outputs = [...access.outputs.values()];
    console.log(`sysex: requesting sequencer state (${outputs.length} output(s):`, outputs.map(o => o.name));
    const msg = [...SYSEX_HEADER, TAG_SEQUENCER_STATE_REQUEST, 0xF7];
    for (const output of outputs) {
      output.send(msg);
    }
  }

  function attachInputs() {
    let count = 0;
    for (const input of access.inputs.values()) {
      input.onmidimessage = onMessage;
      count++;
    }
    const names = [...access.inputs.values()].map(i => i.name).join(', ');
    setStatus(statusEl, count > 0 ? `Connected: ${names}` : 'No MIDI inputs found. Plug in the Dato DRUM.');
    if (count > 0) requestSequencerState();
  }

  attachInputs();

  access.onstatechange = (e) => {
    const port = e.port;
    if (port.type !== 'input') return;
    if (port.state === 'connected') {
      port.onmidimessage = onMessage;
      setStatus(statusEl, `Connected: ${port.name}`);
      dispatch('midi-connected', { name: port.name });
      requestSequencerState();
    } else {
      setStatus(statusEl, `Disconnected: ${port.name}`);
      dispatch('midi-disconnected', { name: port.name });
    }
  };
}

function parseSysEx(data) {
  if (data.length < SYSEX_HEADER.length + 1) return;
  for (let i = 0; i < SYSEX_HEADER.length; i++) {
    if (data[i] !== SYSEX_HEADER[i]) return;
  }
  const tag = data[SYSEX_HEADER.length];
  if (tag === TAG_SEQUENCER_STATE_RESPONSE) {
    const payloadStart = SYSEX_HEADER.length + 1;
    if (data.length < payloadStart + 36 + 1) {
      console.warn(`sysex: SequencerStateResponse too short (got ${data.length} bytes, need ${payloadStart + 37})`);
      return;
    }
    const stepVelocities = Array.from(data.slice(payloadStart, payloadStart + 36));
    const activeNotes = stepVelocities.slice(32); // last 4 bytes
    const steps = stepVelocities.slice(0, 32);
    const litCounts = [0, 1, 2, 3].map(t => steps.slice(t * 8, t * 8 + 8).filter(v => v > 0).length);
    console.log(`sysex: SequencerStateResponse — active steps per track: ${litCounts.join(', ')} | active notes: ${activeNotes.join(', ')}`);
    dispatch('midi-sequencer-state', { stepVelocities });
  } else {
    console.log(`sysex: unhandled tag 0x${tag.toString(16).padStart(2, '0')} (${data.length} bytes)`);
  }
}

function onMessage(e) {
  const [status, data1, data2] = e.data;
  const type = status & 0xF0;
  const channel = status & 0x0F;

  if (status === 0xF0) {
    parseSysEx(e.data);
    return;
  }

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
