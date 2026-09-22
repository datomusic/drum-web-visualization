/**
 * midi.js
 * Web MIDI API wrapper, shared by every instrument.
 * Parses incoming MIDI messages and dispatches typed CustomEvents on `document`.
 * Everything instrument-specific (the SysEx dialect) lives in a device profile
 * passed to initMIDI() — see drum/js/device.js and duo/js/device.js.
 *
 * Events dispatched here:
 *   'midi-cc'               detail: { channel, cc, value }
 *   'midi-note-on'          detail: { channel, note, velocity, time }
 *   'midi-note-off'         detail: { channel, note, time }
 *   'midi-aftertouch'       detail: { channel, note, pressure }
 *   'midi-clock'            detail: { time }
 *   'midi-transport'        detail: { type: 'start'|'continue'|'stop' }
 *   'midi-firmware-version' detail: { version }
 *   'midi-connected'        detail: { name }
 *   'midi-disconnected'     detail: { name }
 * `time` is the message's DOMHighResTimeStamp (ms). Device profiles dispatch
 * their own SysEx-derived events through dispatch().
 *
 * Device profile:
 *   name                       shown in the "plug in the …" status message
 *   requestFirmwareVersion()   send the firmware version request (retried until answered)
 *   onConnected()              optional: further requests / polling once connected
 *   onDisconnected()           optional: stop polling
 *   parseSysEx(data)           handle an incoming SysEx message; return the version
 *                              string if it was a firmware version response
 */

let midiAccess = null;
let device = null;
let deviceName = null;
let firmwareVersion = null;
let statusElement = null;

/** Send a raw MIDI message (e.g. a complete F0 … F7 SysEx) to every connected output. */
export function sendMessage(msg) {
  if (!midiAccess) return;
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
    device.requestFirmwareVersion();
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

export async function initMIDI(statusEl, deviceProfile) {
  statusElement = statusEl;
  device = deviceProfile;
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
    device.onConnected?.();
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
      setStatus(`No MIDI input – plug in the ${device.name}`);
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
      device.onDisconnected?.();
      stopVersionRetry();
      deviceName = null;
      firmwareVersion = null;
      setStatus(`Disconnected: ${port.name}`);
      dispatch('midi-disconnected', { name: port.name });
    }
  };
}

function updateConnectedStatus() {
  if (!deviceName) return;
  setStatus(firmwareVersion ? `Connected: ${deviceName} (${firmwareVersion})` : `Connected: ${deviceName}`);
}

function onSysEx(data) {
  const version = device.parseSysEx(data);
  if (version == null) return;
  firmwareVersion = version;
  stopVersionRetry();
  console.log(`sysex: firmware version ${firmwareVersion}`);
  updateConnectedStatus();
  dispatch('midi-firmware-version', { version: firmwareVersion });
}

function onMessage(e) {
  const [status, data1, data2] = e.data;
  const type = status & 0xF0;
  const channel = status & 0x0F;
  const time = e.timeStamp;

  if (status === 0xF0) {
    onSysEx(e.data);
    return;
  }

  switch (status) {
    case 0xF8: // MIDI Clock
      dispatch('midi-clock', { time });
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
      dispatch('midi-note-off', { channel, note: data1, time });
      break;
    case 0x90: // Note On
      if (data2 === 0) {
        dispatch('midi-note-off', { channel, note: data1, time });
      } else {
        dispatch('midi-note-on', { channel, note: data1, velocity: data2, time });
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

export function dispatch(name, detail) {
  document.dispatchEvent(new CustomEvent(name, { detail }));
}

function setStatus(text) {
  if (statusElement) statusElement.textContent = text;
}
