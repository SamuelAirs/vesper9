# BEACON (reference game)

The idea: a light sweeps back and forth across the three lamps; press while it is on the middle lamp.
A run: each catch adds 100 and speeds the sweep (0.55 sweeps/s rising to 1.55 at 40 catches). A press off the middle costs one of three lives.
Difficulty: speed only. A real game would add new elements over a run (a second light, a moving target lamp, decoys).
Tested: tests/beacon.test.mjs (4 pass); tests/gesture-apps.test.mjs with beacon registered (9 of 9 beacon cases pass on all three paces); played briefly in the simulator at 1024 x 600. Not tested on the device.
Known issues: none. It exists to show the patterns, not to ship.
