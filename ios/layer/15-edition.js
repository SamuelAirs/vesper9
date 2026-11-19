// The handheld edition. The console reads window.VESPER_EDITION before any of its code runs
// (web/apps/edition.js): with it, the console says what is true of a phone, and leaves out what
// only the Pi can do. Without it (the Pi, the browser simulator) nothing changes.
//
// Hidden here, because each needs what a phone does not have: Field Notes (speech runs on the Pi),
// Resonance (the node's microphones; the page could only show a simulated signal), Atmosphere
// (a temperature sensor), Node Scope and Telemetry (the node and the Pi themselves), the
// Encyclopedia (the Pi's offline Wikipedia), and the system menu's MICROPHONE line. A hidden app
// is on no sector's page, in no system-tools list and never a pick of the day; it can still be
// opened by its id (the build's pictures do that).
//
// "add" puts an app on a sector's page: [{ sector: "VOYAGES", apps: ["tideline"] }]. Five apps are
// in the catalog but on no sector (Tideline, Descent, Chronometer, Ephemeris, Atmosphere); that
// is Sam's call, so none is added yet.
(function () {
  "use strict";
  window.VESPER_EDITION = {
    name: "handheld",
    hide: ["transcribe", "resonance", "environment", "diagnostics", "telemetry", "encyclopedia"],
    add: [],
    microphone: false,
  };
})();
