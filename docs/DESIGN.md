# The imagined instrument

VESPER—9 is an offworld field console from an alternative 1979. It belongs on a researcher's desk: useful, tactile, slightly mysterious. The visual language borrows from analog measurement, observatory dials, early electronic instruments, and a civilization whose symbols feel adjacent to ours.

## Visual system

| Role | Color |
| --- | --- |
| Deep screen | `#0c1411` |
| Instrument panel | `#17251e` |
| Structural line | `#39493b` |
| Text | `#d9e5c9` |
| Secondary text | `#94a58d` |
| Phosphor / selected item | `#d6efa4` |
| Amber / target and attention | `#e7b879` |
| Cyan / ocean and measurement | `#8fcbc5` |
| Red / failure | `#eb947a` |

Use monospaced labels for operation and Georgia-style serif headlines for the human-facing atmosphere. Fonts resolve locally; no external font service is required. Fine outlines, generous spacing, numbered channels, orbital diagrams, and a subtle optional scan-line texture create the period feel. A light-filled card is the focus indicator; it remains obvious without animation.

All icons, glyphs, game scenery, and orbital visuals are procedural Canvas/SVG artwork included in source. There are no external sprite packs, stock photos, or copyrighted game assets. The dashboard's central glyph recurs in Orbit Lock, while each game explores a different instrument metaphor.

## The physical vocabulary

Three lights are addressed as **I / II / III**, from left to right. They repeat useful information already shown on screen: Morse key state, Echo Vault pulse position, reaction cue, success/failure, or timer completion. The microphone gets a persistent text status rather than silently borrowing one of the three gameplay lights.

The switch handles advance, choose, act, and escape through an explicit per-app policy. Four rapid clicks normally open the game menu without delaying raw input or interrupting ordinary holds. Signal School and Echo Vault reserve a three-second hold because repeated taps are valid answers. Show the active rule. Earlier game inputs may already occur before a click escape completes; this ambiguity is documented rather than hidden. Menus retain short-release next and hold-release select.

## Sound

Short oscillator tones provide confirmation and a restrained electronic voice. Morse has a continuous sidetone while keyed. No music track loops behind speech recognition. Sound is optional, routed through the Pi or browser, and complements visible cues.

## Adding work in the same style

Name apps like instruments, surveys, archives, or experiments. Make a mechanic understandable in one sentence. Give it a distinct movement or timing behavior, a clear start/result state, and useful feedback from the physical node. Keep interface labels literal even when the surrounding fiction is atmospheric. A person should be able to stop recording, pause, or find the dashboard without decoding the fiction.

The six launch games deliberately cover different uses of one button: precise tapping, variable jumping, continuous thrust, duration memory, physical reaction timing, and scanning selection. This provides more variety than six reskins of the same tap mechanic.
