# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the project

ES modules require HTTP — open via a local server. Vite gives live reload (CSS hot-swaps, JS/HTML edits reload the page):

```bash
npm install   # once
npm run dev
# http://localhost:5173                 — landing page
# http://localhost:5173/drum/test.html  — DRUM production test
# http://localhost:5173/duo/test.html   — DUO production test
# http://localhost:5173/drum/index.html?debug=1 — DRUM visualizer, SVG ID overlay + MIDI console logging
```

Vite is dev-server only — there is no build step. Any static server also works (`python3 -m http.server 8080`).

## Architecture

No build step and no framework. One folder per instrument (`drum/`, `duo/`) plus `shared/`. Each page has its annotated faceplate SVG inlined in the HTML.

**Data flow:** Physical device → USB MIDI → `shared/js/midi.js` (Web MIDI API) → `CustomEvent` on `document` → the instrument's `visualizer.js` / `test.js` → CSS class/transform changes on SVG elements and test rows.

**`shared/js/midi.js`** owns all Web MIDI API interaction and dispatches typed events (`midi-cc`, `midi-note-on`, `midi-note-off`, `midi-clock`, `midi-transport`, `midi-firmware-version`, `midi-connected`, …). Everything instrument-specific goes through a **device profile** (`drum/js/device.js`, `duo/js/device.js`): firmware request, SysEx parsing, extra requests/polling on connect.

**`shared/js/test-runner.js`** is the production test list: one row per test, fill band, rest zone, cursor, pass "punch", faceplate state classes (`.test-idle/.test-active/.test-done`). Built-in test types: `firmware`, `serial`, `cc`. Instruments add their own types as hook objects (see the header comment) — the DRUM adds `notes`, `pad`, `sequencer`; the DUO adds `accent`, `keys`, `transpose`, `play`.

**`shared/js/faceplate.js`** `applyCC(ctrl, value)` moves a knob/slider/button described in an instrument's `controls.js`.

**`<instrument>/js/controls.js`** is the pure data layer mapping MIDI CCs and notes to SVG element IDs. No DOM access.

**SVG element IDs** are the contract between `controls.js` and the instrument's `annotate-svg.py`. If an annotation script changes, the IDs it produces must stay consistent with `controls.js`.

## Regenerating the annotated SVGs

The source SVGs have no semantic IDs (and are gitignored — `*.svg`).
- DUO: `python3 duo/annotate-svg.py` reads `duo/duo-faceplate.svg`, writes the annotated SVG and inlines it into `duo/test.html` between the `faceplate:start/end` markers.
- DRUM: `python3 drum/annotate-svg.py <source.svg>` writes the annotated SVG and inlines it into `drum/index.html` only; `drum/test.html` carries its own inlined copy (same IDs) that must be updated by hand.

## DUO specifics

- Firmware source: `duo-imxrt` repo (`shared/duo/`, `brains2/apps/duo/`). `duo/firmware/MidiFunctions.h` is a reference copy.
- Over USB the DUO's SysEx replies carry an extra `00` after `F0` (`F0 00 7D 64 …`); `duo/js/device.js` accepts both forms and tells replies apart by payload length.
- Only the synth side sends CCs. Speed is derived from MIDI clock (always sent, internal tempo), Length from note gate time while the sequencer runs. Random, Boost and step buttons send nothing and are untested.
- On connect the page sends MIDI Stop and reset-transpose so tests start from a known state.

## Known gaps

- **DRUM step LED track mapping** (`TRACK_STEP_MAP` in `drum/js/controls.js`) is a best guess — verify with the device using `?debug=1`.
- **DUO slider direction** (`dir` in `duo/js/controls.js`) and **step button order** (`step-1…8` in `duo/annotate-svg.py`) are unverified against hardware.
