// Readable text in the games. The games draw a 960 x 540 picture and their smaller text at 10 to
// 18 of its pixels, which on a phone's picture (393 to 466 points wide) is 4 to 9 points. Here the
// app asks the console for a floor under that text: while a game on the reviewed list draws, no
// text is drawn smaller than FLOOR_PT points as the picture is shown (web/engine/draw.js text(),
// set by the host in web/main.js fitCanvas() and frame()). A game not on the list draws exactly
// as on the console: a floored size can overflow a screen laid out for small text, so each game
// joins the list only once it has been looked at in the Duo's postures and on a plain phone, and
// what overflowed was fixed in its own file (where its layout follows the floor, textSize()).
//
//   vesperApp.textFloor(points)  set the floor (0 or false: none); the build's checks use it
//   vesperApp.textApps()         the reviewed list
(function () {
  "use strict";
  var layer = window.vesperLayer, app = window.vesperApp;

  // 9 points: the size the critic's review (2026-11-19) found readable on the Duo; under it the
  // games' secondary text (the HUD, hints, list lines) was hard to read on every layout.
  var FLOOR_PT = 9;
  // Reviewed 2026-11-19 in the Duo's postures and on a plain phone; what overflowed was fixed in
  // each game's own file (tests/ios-text-browser.cjs checks every one of them).
  var REVIEWED = [
    "highbar", "cairn", "twinbeat", "orbit", "runner", "outpost", "perihelion", "wayfinder",
    "ballista", "glyphs", "pocketlinks", "nightgrid", "drift", "echo", "relay",
    "meridian", "ricochet", "morse"
  ];

  var points = FLOOR_PT, listed = {};
  REVIEWED.forEach(function (id) { listed[id] = true; });

  // Page pixels per point. Upright, and wherever the page is laid out at the display's own size,
  // one; a phone held sideways is laid out a little wider than it is (30-fit.js), so a point is
  // a little more than a page pixel. The app says the window's width in points with every fold.
  var pointsWide = 0;
  function remember(told) {
    if (told && told.window && told.window[0] > 0) pointsWide = told.window[0];
  }
  remember(layer.given.fold);
  var fold = app.fold;
  if (typeof fold === "function") {
    app.fold = function (told) {
      remember(told);
      return fold.apply(this, arguments);
    };
  }
  function pagePerPoint() {
    var laid = document.documentElement.clientWidth;
    var k = pointsWide > 0 && laid > 0 ? laid / pointsWide : 1;
    return k > 0.5 && k < 2 ? k : 1;
  }

  // What the console asks each time it sizes a game's picture: the floor in page pixels, or 0.
  function rule(id) {
    return points > 0 && listed[id] ? points * pagePerPoint() : 0;
  }

  layer.whenLoaded(function (vesper) {
    if (typeof vesper.textFloor !== "function") return;
    vesper.textFloor(rule);
    app.textFloor = function (value) {
      points = Number(value) > 0 ? Number(value) : 0;
      vesper.textFloor(rule);
    };
  });
  app.textApps = function () { return REVIEWED.slice(); };
})();
