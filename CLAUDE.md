# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the project

ES modules require HTTP — open via a local server. Vite gives live reload (CSS hot-swaps, JS/HTML edits reload the page):

```bash
npm install   # once
npm run dev
# http://localhost:5173
# http://localhost:5173?debug=1   — SVG ID overlay + MIDI console logging
```

Vite is dev-server only — there is no build step. Any static server also works (`python3 -m http.server 8080`).

## Regenerating the annotated SVG

The source SVG (`dato-drum-faceplate-drawing.svg`) has no semantic IDs. Run the annotation script after any change to the source SVG:

```bash
python3 annotate-svg.py
```

This overwrites `dato-drum-faceplate-annotated.svg`. Then rebuild `index.html` by re-running the inline step in `annotate-svg.py` (or update manually — the SVG is inlined directly into `index.html`).

## Architecture

There is no build step and no framework. The page is a single `index.html` with the annotated SVG inlined, four JS ES modules, and one CSS file.

**Data flow:** Physical device → USB MIDI → `midi.js` (Web MIDI API) → `CustomEvent` on `document` → `visualizer.js` → CSS class/transform changes on SVG elements.

**`js/controls.js`** is the pure data layer — it maps MIDI CC numbers and note numbers to SVG element IDs. This is the file to update when refining the step LED track mapping (`TRACK_STEP_MAP`) or adding controls. No DOM access here.

**`js/midi.js`** owns all Web MIDI API interaction. It parses raw MIDI bytes and dispatches typed `CustomEvent`s (`midi-cc`, `midi-note-on`, `midi-note-off`, `midi-aftertouch`, `midi-clock`, `midi-transport`). Debug MIDI logging lives in `js/main.js` by listening to these same events.

**`js/visualizer.js`** is the only file that touches the DOM. It listens for the custom events and applies CSS classes (`.pressed`, `.hit`, `.active`, `.playing`) and inline `transform: rotate()` to SVG elements via their IDs.

**SVG element IDs** are the contract between `controls.js` (which names them) and `visualizer.js` (which uses them). If `annotate-svg.py` is changed, the IDs it produces must stay consistent with `controls.js`.

## Known gaps

- **Step LED track mapping** (`TRACK_STEP_MAP` in `js/controls.js`) is `null` — the 40 ring LEDs are ordered by polar angle but not yet grouped by track. Verify with the physical device using `?debug=1`, then fill in the map and update the `handleClock()` logic in `visualizer.js`.
- Several controls visible in the screenshot (TEMPO knob, per-step volume) are not yet identified in the SVG and have no IDs.
