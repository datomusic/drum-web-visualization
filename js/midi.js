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
 *   'midi-firmware-version' detail: { version }
 *   'midi-setting'          detail: { id, value }
 *   'midi-connected'        detail: { name }
 *   'midi-disconnected'     detail: { name }
 */

// SysEx header: F0 + Dato manufacturer ID (00 22 01) + DRUM device ID (65)
const SYSEX_HEADER = [0xF0, 0x00, 0x22, 0x01, 0x65];
const TAG_FIRMWARE_VERSION_REQUEST = 0x01;
const TAG_REBOOT_BOOTLOADER        = 0x0B;
const TAG_SEQUENCER_STATE_REQUEST  = 0x30;
const TAG_SEQUENCER_STATE_RESPONSE = 0x31;
const TAG_GET_SETTING              = 0x40;
const TAG_SETTING_VALUE            = 0x41;
const TAG_SET_SETTING              = 0x42;

export const SETTING_MIDI_CHANNEL = 0x01;
export const SETTING_SLIDER_MODE  = 0x02;

const SEQUENCER_POLL_INTERVAL_MS = 200;

let midiAccess = null;
let pollTimer = null;
let deviceName = null;
let firmwareVersion = null;
let statusElement = null;

function sendSysEx(bytes) {
  if (!midiAccess) return;
  const msg = [...SYSEX_HEADER, ...bytes, 0xF7];
  for (const output of midiAccess.outputs.values()) {
    // Sending on a disconnected port throws InvalidStateError; skip stale ports
    if (output.state !== 'connected') continue;
    output.send(msg);
  }
}

// After a hot-plug the input port reports 'connected' before the output port
// does (and before the device is ready to answer), so a single request is lost.
// Retry the firmware version request until a response arrives.
const VERSION_RETRY_INTERVAL_MS = 500;
const VERSION_RETRY_MAX = 10;
let versionRetryTimer = null;

function requestFirmwareVersionWithRetry() {
  stopVersionRetry();
  let attempts = 0;
  const attempt = () => {
    if (firmwareVersion !== null || attempts >= VERSION_RETRY_MAX) {
      stopVersionRetry();
      return;
    }
    attempts++;
    requestFirmwareVersion();
  };
  attempt();
  versionRetryTimer = setInterval(attempt, VERSION_RETRY_INTERVAL_MS);
}

function stopVersionRetry() {
  if (versionRetryTimer !== null) {
    clearInterval(versionRetryTimer);
    versionRetryTimer = null;
  }
}

export function requestSequencerState() {
  sendSysEx([TAG_SEQUENCER_STATE_REQUEST]);
}

export function requestFirmwareVersion() {
  sendSysEx([TAG_FIRMWARE_VERSION_REQUEST]);
}

export function rebootToBootloader() {
  console.log('sysex: RebootBootloader');
  sendSysEx([TAG_REBOOT_BOOTLOADER]);
}

export function getSetting(id) {
  sendSysEx([TAG_GET_SETTING, id & 0x7F]);
}

export function setSetting(id, value) {
  console.log(`sysex: SetSetting id=0x${id.toString(16).padStart(2, '0')} value=${value}`);
  sendSysEx([TAG_SET_SETTING, id & 0x7F, value & 0x7F]);
}

export async function initMIDI(statusEl) {
  statusElement = statusEl;
  if (!navigator.requestMIDIAccess) {
    setStatus('Web MIDI API not supported in this browser.');
    return;
  }

  try {
    midiAccess = await navigator.requestMIDIAccess({ sysex: true });
  } catch (err) {
    setStatus(`MIDI access denied: ${err.message}`);
    return;
  }

  function onConnected() {
    requestFirmwareVersionWithRetry();
    getSetting(SETTING_MIDI_CHANNEL);
    getSetting(SETTING_SLIDER_MODE);
    startPolling();
  }

  function attachInputs() {
    let count = 0;
    for (const input of midiAccess.inputs.values()) {
      input.onmidimessage = onMessage;
      count++;
    }
    const names = [...midiAccess.inputs.values()].map(i => i.name).join(', ');
    if (count > 0) {
      deviceName = names;
      updateConnectedStatus();
      dispatch('midi-connected', { name: names });
      onConnected();
    } else {
      setStatus('No MIDI input – plug in the DRUM');
    }
  }

  attachInputs();

  midiAccess.onstatechange = (e) => {
    const port = e.port;
    if (port.type === 'output') {
      // Output port came up after the input: (re)send the initial requests now
      if (port.state === 'connected' && deviceName && firmwareVersion === null) onConnected();
      return;
    }
    if (port.state === 'connected') {
      port.onmidimessage = onMessage;
      deviceName = port.name;
      firmwareVersion = null;
      updateConnectedStatus();
      dispatch('midi-connected', { name: port.name });
      onConnected();
    } else {
      stopPolling();
      stopVersionRetry();
      deviceName = null;
      firmwareVersion = null;
      setStatus(`Disconnected: ${port.name}`);
      dispatch('midi-disconnected', { name: port.name });
    }
  };
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(requestSequencerState, SEQUENCER_POLL_INTERVAL_MS);
  requestSequencerState();
}

function stopPolling() {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function updateConnectedStatus() {
  if (!deviceName) return;
  setStatus(firmwareVersion ? `Connected: ${deviceName} (${firmwareVersion})` : `Connected: ${deviceName}`);
}

function parseSysEx(data) {
  if (data.length < SYSEX_HEADER.length + 1) return;
  for (let i = 0; i < SYSEX_HEADER.length; i++) {
    if (data[i] !== SYSEX_HEADER[i]) return;
  }
  const tag = data[SYSEX_HEADER.length];
  const payloadStart = SYSEX_HEADER.length + 1;
  const payload = data.slice(payloadStart, data.length - 1); // strip trailing F7

  if (tag === TAG_SEQUENCER_STATE_RESPONSE) {
    if (payload.length < 36) {
      console.warn(`sysex: SequencerStateResponse too short (${payload.length} payload bytes, need 36)`);
      return;
    }
    const stepVelocities = Array.from(payload.slice(0, 36));
    dispatch('midi-sequencer-state', { stepVelocities });
  } else if (tag === TAG_FIRMWARE_VERSION_REQUEST) {
    firmwareVersion = decodeVersion(payload);
    stopVersionRetry();
    console.log(`sysex: firmware version ${firmwareVersion}`);
    updateConnectedStatus();
    dispatch('midi-firmware-version', { version: firmwareVersion });
  } else if (tag === TAG_SETTING_VALUE) {
    if (payload.length < 2) return;
    const id = payload[0];
    const value = payload[1];
    console.log(`sysex: SettingValue id=0x${id.toString(16).padStart(2, '0')} value=${value}`);
    dispatch('midi-setting', { id, value });
  } else {
    console.log(`sysex: unhandled tag 0x${tag.toString(16).padStart(2, '0')} (${data.length} bytes)`);
  }
}

// Firmware version payload may be an ASCII string ("v0.2.0") or 3 raw bytes
// (major, minor, patch) — handle both.
function decodeVersion(payload) {
  const bytes = Array.from(payload);
  const isAscii = bytes.length > 0 && bytes.every(b => b >= 0x20 && b < 0x7F);
  if (isAscii && bytes.length > 3) {
    return String.fromCharCode(...bytes).replace(/\0+$/, '').trim();
  }
  if (bytes.length >= 3) {
    return `v${bytes[0]}.${bytes[1]}.${bytes[2]}`;
  }
  if (isAscii) return String.fromCharCode(...bytes);
  return `v? (${bytes.join(' ')})`;
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

function setStatus(text) {
  if (statusElement) statusElement.textContent = text;
}
