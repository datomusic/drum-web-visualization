/**
 * device.js
 * DUO SysEx dialect: the device profile for shared/js/midi.js.
 * Reference: duo/firmware/MidiFunctions.h (duo-imxrt, shared/duo/MidiFunctions.h).
 *
 * Requests are F0 7D 64 <cmd> F7. Responses carry no command byte, so they are
 * told apart by payload length:
 *   firmware version   F0 7D 64 major minor patch F7          (3 bytes)
 *   serial number      F0 7D 64 <4 groups of 5 × 7 bits> F7   (20 bytes)
 * Over USB the DUO puts an extra 00 after the F0 (seen on firmware 1.2.0:
 * F0 00 7D 64 01 02 00 F7), so both forms are accepted.
 *
 * Extra events dispatched:
 *   'midi-serial-number'  detail: { serial }  hex words, e.g. "1A2B3C4D-5E6F7081"
 */

import { sendMessage, dispatch } from '../../shared/js/midi.js';

const SYSEX_HEADER = [0xF0, 0x7D, 0x64]; // Dato (non-commercial ID 7D) + DUO (64)
const CMD_FIRMWARE_VERSION  = 0x01;
const CMD_SERIAL_NUMBER     = 0x02;
const CMD_REBOOT_BOOTLOADER = 0x0B;
const CMD_RESET_TRANSPOSE   = 0x0C;

const FIRMWARE_PAYLOAD_LENGTH = 3;
const SERIAL_PAYLOAD_LENGTH = 20;

const MIDI_STOP = 0xFC;

let serialReceived = false;

function send(cmd) {
  sendMessage([...SYSEX_HEADER, cmd, 0xF7]);
}

export function rebootToBootloader() {
  send(CMD_REBOOT_BOOTLOADER);
}

/** Put the keyboard back on its untransposed scale. */
export function resetTranspose() {
  send(CMD_RESET_TRANSPOSE);
}

/** Four 32-bit words, each sent as 5 × 7 bits (MSB first); trailing all-zero words dropped. */
function decodeSerial(payload) {
  const words = [];
  for (let w = 0; w < 4; w++) {
    let v = 0;
    for (let i = 0; i < 5; i++) v = v * 128 + payload[w * 5 + i];
    words.push((v >>> 0).toString(16).toUpperCase().padStart(8, '0'));
  }
  while (words.length > 1 && /^0+$/.test(words.at(-1))) words.pop();
  return words.join('-');
}

export const DUO = {
  name: 'DUO',

  // Called on every retry until a version arrives, so the serial request rides along.
  requestFirmwareVersion() {
    send(CMD_FIRMWARE_VERSION);
    if (!serialReceived) send(CMD_SERIAL_NUMBER);
  },

  // Start every test from a known state: sequencer stopped (the DUO obeys MIDI
  // Stop) and keyboard untransposed, so key notes are the plain scale.
  onConnected() {
    serialReceived = false;
    sendMessage([MIDI_STOP]);
    resetTranspose();
  },

  parseSysEx(data) {
    const start = data[1] === 0x00 ? 2 : 1; // skip the extra 00 the DUO sends over USB
    if (data[start] !== SYSEX_HEADER[1] || data[start + 1] !== SYSEX_HEADER[2]) return;
    const payload = data.slice(start + 2, data.length - 1); // strip trailing F7
    if (payload.length === FIRMWARE_PAYLOAD_LENGTH) {
      return `v${payload[0]}.${payload[1]}.${payload[2]}`;
    }
    if (payload.length === SERIAL_PAYLOAD_LENGTH) {
      serialReceived = true;
      const serial = decodeSerial(payload);
      console.log(`sysex: serial number ${serial}`);
      dispatch('midi-serial-number', { serial });
      return;
    }
    console.log(`sysex: unhandled DUO message (${data.length} bytes)`);
  },
};
