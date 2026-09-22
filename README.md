# Dato production tests

Browser-based production tests for Dato instruments, driven over Web MIDI. Each
instrument has a test page showing its faceplate next to a checklist; controls
turn green on the faceplate and in the list as the operator exercises them.

It started as a MIDI visualization of the [Dato DRUM](https://www.dato.mu/drum),
which is still here.

| Page | |
|---|---|
| `drum/test.html` | DRUM production test |
| `duo/test.html` | DUO production test |
| `drum/index.html` | DRUM MIDI visualizer (with MIDI channel / slider mode settings) |
| `drum/sample-browser.html` | DRUM factory sample browser |

`test.html` at the root redirects to the DRUM test so existing bookmarks keep working.

## Setup

ES modules need HTTP. With live reload:

```bash
npm install   # once
npm run dev   # http://localhost:5173
```

Any static server works too (`python3 -m http.server 8080`). Use Chrome, grant
MIDI (SysEx) access when asked, and plug the instrument in via USB, before or
after opening the page. The test list restarts whenever a device connects or
disconnects.

## Project structure

```
index.html              landing page linking all pages
test.html               redirect to drum/test.html
shared/
  css/base.css          design tokens + page layout
  css/test.css          test list styling
  js/midi.js            Web MIDI transport; takes a device profile for the SysEx dialect
  js/test-runner.js     the test list: rows, fill band, rest zone, built-in test types
  js/faceplate.js       moves knobs / sliders / buttons in an inlined SVG from CC values
drum/
  test.html, index.html, sample-browser.html
  annotate-svg.py       adds IDs to the DRUM SVG and inlines it into index.html
  css/, js/             DRUM device profile, control map, visualizer, tests, line-in tone
  samples/              factory kit
duo/
  test.html
  annotate-svg.py       adds IDs to the DUO SVG and inlines it into test.html
  css/, js/             DUO device profile, control map, visualizer, tests
  firmware/MidiFunctions.h   reference copy of the DUO's MIDI implementation
```

### Adding an instrument

1. `<name>/js/device.js`: a device profile for `initMIDI()` (firmware version
   request and SysEx parsing, see `shared/js/midi.js`).
2. An annotated faceplate SVG inlined in `<name>/test.html`.
3. `<name>/js/test.js`: the ordered test list for `createTestRunner()`, plus any
   test types beyond the built-in `firmware`, `serial` and `cc`
   (see `shared/js/test-runner.js`).
4. `<name>/css/test.css`: colors for the faceplate's `.test-idle` /
   `.test-active` / `.test-done` states.

## DUO test

The DUO reports less over MIDI than the DRUM, so some controls are measured
indirectly:

| Control | How it is tested |
|---|---|
| Release, Freq, Wave, Res, Amp, Detune | CC sweep across 90% of the range, then left in the middle |
| Crush, Delay, Glide | CC 127 while held, left released |
| Accent | a note with velocity 127 (accent held), then one with 100 |
| Speed | tempo measured from the MIDI clock the DUO always sends (30–603 BPM), swept, then left in the middle |
| Length | note length measured while the sequencer runs (10–200 ms gate), swept, then left in the middle |
| Keyboard | every key's note heard while the sequencer is stopped |
| Transpose | a note above the top key (↑) and below the bottom key (↓) |
| Play | sequencer started and stopped, left stopped |
| Firmware, serial number | SysEx request |

Random, Boost and the 8 step buttons send nothing over MIDI and are not tested
(faded on the faceplate). On connect the page sends the DUO a MIDI Stop and a
reset-transpose SysEx, so every test starts from a stopped, untransposed state.

Speed and Length are derived only until the firmware sends CCs for them — see
[duo/FIRMWARE-TODO.md](duo/FIRMWARE-TODO.md).

## Debug mode (DRUM visualizer)

Add `?debug=1` to `drum/index.html` to render all SVG element IDs on the
faceplate and log incoming MIDI to the console.

## Regenerating a faceplate

The source SVGs have no semantic IDs. Each `annotate-svg.py` recognises elements
by fill and position, writes an annotated SVG and inlines it into the page.
The IDs it produces are the contract with that instrument's `js/controls.js`.

```bash
python3 duo/annotate-svg.py                 # reads duo/duo-faceplate.svg
python3 drum/annotate-svg.py <source.svg>
```

SVG files are gitignored, so the source SVGs live only locally; the annotated
result is committed as part of the HTML.
