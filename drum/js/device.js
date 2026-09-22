/**
 * device.js
 * DRUM SysEx dialect: the device profile for shared/js/midi.js, plus the
 * DRUM-only requests (settings, sequencer state, bootloader).
 *
 * Extra events dispatched:
 *   'midi-sequencer-state'  detail: { stepVelocities: number[] } (36 bytes: 4 tracks × 8 steps + 4 active notes)
 *   'midi-setting'          detail: { id, value }
 */

import { sendMessage, dispatch } from '../../shared/js/midi.js';

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

let pollTimer = null;

function send(bytes) {
  sendMessage([...SYSEX_HEADER, ...bytes, 0xF7]);
}

export function requestSequencerState() {
  send([TAG_SEQUENCER_STATE_REQUEST]);
}

export function rebootToBootloader() {
  console.log('sysex: RebootBootloader');
  send([TAG_REBOOT_BOOTLOADER]);
}

export function getSetting(id) {
  send([TAG_GET_SETTING, id & 0x7F]);
}

export function setSetting(id, value) {
  console.log(`sysex: SetSetting id=0x${id.toString(16).padStart(2, '0')} value=${value}`);
  send([TAG_SET_SETTING, id & 0x7F, value & 0x7F]);
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

export const DRUM = {
  name: 'DRUM',

  requestFirmwareVersion() {
    send([TAG_FIRMWARE_VERSION_REQUEST]);
  },

  onConnected() {
    getSetting(SETTING_MIDI_CHANNEL);
    getSetting(SETTING_SLIDER_MODE);
    startPolling();
  },

  onDisconnected() {
    stopPolling();
  },

  parseSysEx(data) {
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
      return decodeVersion(payload);
    } else if (tag === TAG_SETTING_VALUE) {
      if (payload.length < 2) return;
      const id = payload[0];
      const value = payload[1];
      console.log(`sysex: SettingValue id=0x${id.toString(16).padStart(2, '0')} value=${value}`);
      dispatch('midi-setting', { id, value });
    } else {
      console.log(`sysex: unhandled tag 0x${tag.toString(16).padStart(2, '0')} (${data.length} bytes)`);
    }
  },
};
