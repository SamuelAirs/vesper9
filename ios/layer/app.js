// VESPER-9 on iPhone: what the page needs to live inside the app's web view. ios/build-web.py
// puts this file in the page's <head>, so it runs before the console's own code. Nothing here
// changes a game: it keeps the saves, fits the page to the display and its fold, and tells the
// app when the button moves.
//
// The app (ios/Vesper9/Console.swift) gives the page, before any of it runs:
//   window.__vesperNative = { saved: { key: text, ... }, launch: "app id" or null,
//                             import: { scores, progress } or null, fold: as below or null }
// calls, whenever the window or the fold changes:
//   vesperApp.fold({ posture, crease: [x, y, w, h] or null, safe: [top, right, bottom, left],
//                    window: [w, h] })
// and listens on window.webkit.messageHandlers.vesper for:
//   { t: "saves", items }      every saved item, once at start
//   { t: "save", key, value }  one item changed
//   { t: "remove", key }  { t: "clear" }
//   { t: "imported", scores, progress }  the console's saves were taken in (see below)
//   { t: "press", down }       the on-screen button or the game was pressed or let go
//   { t: "ready" }             the console has loaded
(function () {
  "use strict";
  var handlers = window.webkit && window.webkit.messageHandlers;
  var native = handlers && handlers.vesper;
  var given = window.__vesperNative || {};
  var root = document.documentElement;
  function post(message) {
    try {
      if (native) native.postMessage(message);
    } catch (error) {}
  }
  root.classList.add("vesper-app");
  root.setAttribute("data-posture", "plain");

  // Saves. The console keeps them in the web view's localStorage (one item, "vesper-demo"); the
  // app keeps a copy of every item in its own file as well. The web view's copy is the one in
  // use. The app's copy only fills in what is missing here (iOS emptied the web view's storage,
  // or the app was restored), so an older copy never replaces newer progress.
  var store = null, brought = null;
  try {
    store = window.localStorage;
    var saved = given.saved || {};
    Object.keys(saved).forEach(function (key) {
      if (typeof saved[key] === "string" && store.getItem(key) === null) store.setItem(key, saved[key]);
    });

    // The console's own saves, brought over once: a file made from the Pi's data by
    // ios/console-saves.py, which the person puts in the app's folder (docs/IOS.md). A best
    // score stays at the higher of the two; each game's progress in the file replaces this
    // phone's; settings and timers stay the phone's.
    var file = given.import;
    if (file && typeof file === "object" && (file.scores || file.progress)) {
      var mine = {};
      try {
        mine = JSON.parse(store.getItem("vesper-demo") || "{}") || {};
      } catch (error) {}
      var scores = mine.scores || {}, progress = mine.progress || {}, bests = 0, games = 0;
      Object.keys(file.scores || {}).forEach(function (key) {
        var value = Number(file.scores[key]);
        if (isFinite(value) && !(scores[key] >= value)) {
          scores[key] = value;
          bests++;
        }
      });
      Object.keys(file.progress || {}).forEach(function (app) {
        progress[app] = file.progress[app];
        games++;
      });
      mine.scores = scores;
      mine.progress = progress;
      store.setItem("vesper-demo", JSON.stringify(mine));
      brought = { scores: bests, progress: games };
    }

    var items = {};
    for (var i = 0; i < store.length; i++) items[store.key(i)] = store.getItem(store.key(i));
    post({ t: "saves", items: items });
    if (brought) post({ t: "imported", scores: brought.scores, progress: brought.progress });
    var proto = Storage.prototype, setItem = proto.setItem, removeItem = proto.removeItem, clear = proto.clear;
    proto.setItem = function (key, value) {
      setItem.call(this, key, value);
      if (this === store) post({ t: "save", key: String(key), value: String(value) });
    };
    proto.removeItem = function (key) {
      removeItem.call(this, key);
      if (this === store) post({ t: "remove", key: String(key) });
    };
    proto.clear = function () {
      clear.call(this);
      if (this === store) post({ t: "clear" });
    };
  } catch (error) {}

  // The viewport. The page's play mode (the game fills the screen, style.css) needs 700 x 400.
  // A phone held sideways is a little short of that, so the page is laid out at the smallest
  // size that has it and shown slightly smaller. Upright, and on anything large enough, the
  // page is laid out at the display's own size. The app says the window's real size in points
  // whenever that changes, and from then on only the app's numbers count. Until its first call
  // the size is taken from the screen (never from the page's own width, which this changes: the
  // two would chase each other).
  var NEED_W = 700, NEED_H = 400;
  var viewport = document.querySelector('meta[name="viewport"]');
  var current = "", sized = false;
  var scale = 1; // page pixels per point: above 1 while a sideways phone is laid out wider than it is
  function fit(width, height) {
    if (!viewport) return;
    if (width > 0 && height > 0) sized = true;
    else if (sized) return;
    else {
      var a = window.screen.width, b = window.screen.height;
      var sideways = window.innerWidth > window.innerHeight;
      width = sideways ? Math.max(a, b) : Math.min(a, b);
      height = sideways ? Math.min(a, b) : Math.max(a, b);
    }
    var wide = "width=device-width, initial-scale=1";
    scale = 1;
    if (width > height && (width < NEED_W || height < NEED_H)) {
      var laid = Math.ceil(Math.max(NEED_W, (width * NEED_H) / height));
      wide = "width=" + laid;
      scale = laid / width;
    }
    var content = wide + ", viewport-fit=cover, user-scalable=no";
    if (content !== current) {
      current = content;
      viewport.setAttribute("content", content);
    }
  }
  fit();
  window.addEventListener("resize", function () { fit(); });
  window.addEventListener("orientationchange", function () { setTimeout(fit, 60); });

  // The fold. The app reads the display's crease and hinge (iPhone Duo) and says how the phone is
  // held; app.css lays every screen out by it:
  //   html[data-posture]   plain | openBook | halfBook | openTall | laptop
  //   html[data-fold]      "across" (the crease runs left to right: openTall, laptop),
  //                        "down" (top to bottom: openBook, halfBook), or absent
  //   --fold-start         where the crease's band begins (from the top, or from the left)
  //   --fold-band          how thick it is
  //   --sat --sar --sab --sal   the window's safe areas, as the app measured them
  function px(points) {
    return Math.round(points * scale * 100) / 100 + "px";
  }
  function fold(told) {
    told = told || {};
    var style = root.style;
    if (told.window && told.window.length === 2) fit(told.window[0], told.window[1]);
    var safe = told.safe;
    ["--sat", "--sar", "--sab", "--sal"].forEach(function (name, i) {
      if (safe && safe.length === 4 && safe[i] >= 0) style.setProperty(name, px(safe[i]));
      else style.removeProperty(name);
    });
    var crease = told.crease, posture = String(told.posture || "plain"), way = "";
    if (posture !== "plain" && crease && crease.length === 4 && Math.max(crease[2], crease[3]) > 0)
      way = crease[2] >= crease[3] ? "across" : "down";
    root.setAttribute("data-posture", way ? posture : "plain");
    if (way) {
      root.setAttribute("data-fold", way);
      style.setProperty("--fold-start", px(way === "across" ? crease[1] : crease[0]));
      style.setProperty("--fold-band", px(way === "across" ? crease[3] : crease[2]));
    } else {
      root.removeAttribute("data-fold");
      style.removeProperty("--fold-start");
      style.removeProperty("--fold-band");
    }
    // The console sizes its canvas when the window does; a new layout is the same to it.
    window.dispatchEvent(new Event("resize"));
  }
  // What the app read before the page was loaded: the first picture is already laid out by it.
  if (given.fold) fold(given.fold);

  // The button. The app answers each press and release with a tap of the phone's haptics.
  var pressed = false;
  function onButton(target) {
    return !!(target && target.closest && target.closest("#arcade, #menu-arcade, #game"));
  }
  document.addEventListener("pointerdown", function (event) {
    if (pressed || event.button !== 0 || !onButton(event.target)) return;
    pressed = true;
    post({ t: "press", down: true });
  }, true);
  function release() {
    if (!pressed) return;
    pressed = false;
    post({ t: "press", down: false });
  }
  document.addEventListener("pointerup", release, true);
  document.addEventListener("pointercancel", release, true);

  // Once the console has loaded: say so, name what was brought over, and open the app named at
  // launch (the build's pictures).
  var tries = 0;
  var waiting = setInterval(function () {
    var loaded = window.vesper && window.vesper.loaded;
    if (!loaded && ++tries < 600) return;
    clearInterval(waiting);
    if (!loaded) return;
    post({ t: "ready" });
    try {
      if (brought) window.vesper.toast("CONSOLE SAVES BROUGHT OVER / " + brought.scores + " BESTS / " + brought.progress + " GAMES");
      if (given.launch) window.vesper.launch(String(given.launch));
    } catch (error) {}
  }, 50);

  window.vesperApp = { fit: fit, fold: fold };
})();
