# DUO: send CCs for Speed and Length

The DUO test currently derives two pot positions indirectly, because the
firmware sends no CC for them:

| Pot | Derived from (duo/js/test.js) | Drawback |
|---|---|---|
| Speed | tempo measured from MIDI clock, inverted through the firmware's tempo curve | needs ~1 s of clock, bursty USB timing, curve copied from `tempo.cpp` |
| Length | note gate time measured while the sequencer runs | operator must run the sequencer; cut-off notes must be filtered out |

## Firmware change (duo-imxrt, `shared/duo/MidiFunctions.h`)

`synth_parameters` already has `speed` and `gateLength` (10-bit, read in
`pots_read()`), so it's two lines in `midi_send_cc()`:

```cpp
// Speed CC 15 (same number as the DRUM's tempo pot)
send_changed_value(speed, 15);
// Length CC 75 (free on the DUO)
send_changed_value(gateLength, 75);
```

CC numbers are a suggestion; the DUO already uses 7, 65, 70, 71, 72, 74, 80,
81, 94 (and 123 for all notes off). Add them to the implementation chart at the
top of the file and bump the firmware version.

## Page change once that firmware is out

- `duo/js/test.js`
  - `speed` / `length` tests: replace `knob`, `unit`, `format` with `cc: 15` / `cc: 75`.
  - Delete the clock and gate measurement (the tempo curve, `clockPeriod`,
    the `midi-clock` and `midi-note-off` listeners, `observeKnob`, the
    `NOTE_*` / `CLOCK_*` / `GATE_*` constants).
  - Set `FIRMWARE_MIN_VERSION` to the new release, so older units fail the
    firmware row instead of silently failing Speed/Length.
- `duo/js/controls.js`: move Speed and Length into `CC_CONTROLS` as knobs
  (`knob-speed`, `knob-length`) and drop `SPEED_KNOB` / `LENGTH_KNOB`.
- Update the DUO table in `README.md` and the DUO notes in `CLAUDE.md`.

## Worth considering in the same release

Controls that send nothing today and therefore aren't tested: Random, Boost,
the 8 step buttons and the transpose arrows (tested only via note numbers).
Momentary CCs for these (127 held / 0 released, like Crush/Delay/Glide) would
let the test cover them with the existing `cc` test type and `REST_LOW`.

## Still to verify on hardware (current page)

- Left arrow = transpose down.
- Step button order `step-1…8` in `duo/annotate-svg.py` (IDs only, not tested).
- Length measurement with the sequencer running.
