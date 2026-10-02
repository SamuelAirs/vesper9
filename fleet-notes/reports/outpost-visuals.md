# Outpost visuals (scene module), 2026-10-02

Owner: `web/apps/outpost-scene.js`, `tests/outpost-scene.test.mjs`. Nothing here was verified on the device.

## Performance
- Still scenery (sky, stars, far world, constellations, both ridges, stage props, ground, every machine's
  body, the soft-light sprite and the aurora strip) is painted once into OffscreenCanvas layers, turned into
  ImageBitmaps, and drawn with one drawImage each. A layer is repainted only when the stage, the charted sky
  or the render scale changes.
- No gradient is created per frame: every gradient is made once per context (WeakMap cache).
- Canvas calls on the frame, from a headless page (`fresh / early / mid / late / ring`): before
  163 / 268 / 556 / 1276 / 292, after 38 / 78 / 171 / 315 / 128.
- Headless Chromium uses software rendering, so times are only relative. With each frame forced to raster
  (`getImageData` after each draw): before 1.3-1.6 ms early/mid and about 3.3 ms late, after 0.6-1.5 ms and
  about 2.9 ms late. The aurora strip is the largest remaining fill.
- Without OffscreenCanvas (node tests, old browsers) the same painters draw straight onto the frame,
  leaving out the faint star band and the stones.

## What changed on screen
- A sky that darkens overhead and warms toward the horizon by stage, more stars with a faint band across
  them, a few that twinkle, and a meteor every 17 s (not under Reduced Motion).
- A banded far world with an atmosphere, a hazy far ridge behind the near one, and ground tracks and stones.
- Machines: dark silhouettes so they hide what is behind them, lit windows, and new bodies for the two late
  machines (Zero-Point Listener: a caged glowing core; Silent Array: dark slabs with light climbing them).
  A pool of light under each working machine follows its output. Small copies of a machine stand behind it
  at 10, 25, 50 and 100 owned, replacing the old post-and-circle marks.
- The horizon carries the groove (amber as it builds, cyan when full). The signal count jumps on each tap.
- A new stage fades in over 1.6 s. Constellations carry their names. The aurora is a scrolling filled strip.
- The build ring shows the machine (or the machine an upgrade improves) in the corner of the detail card.
- Panels and cards have amber corner brackets. The "station grows" line moved down to y 292 on a dark plate,
  clear of the floating numbers.

## Left for others
- The floating numbers' start point is chosen in `outpost.js` (y 215); they now rise more slowly.
- The play area is letterboxed in the console; the platform polish thread owns that layout.
