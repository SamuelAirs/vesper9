// VESPER-9 on iPhone: what the page needs to live inside the app's web view. ios/build-web.py
// puts every .js file in this folder, in the order of their names, in the page's <head>, so they
// run before the console's own code. Nothing here changes a game: the parts keep the saves, fit
// the page to the display and its fold, and tell the app when the button moves.
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
//   { t: "imported", scores, progress }  the console's saves were taken in
//   { t: "press", down }       the on-screen button or the game was pressed or let go
//   { t: "knock", side }       a case plate or CASE key was tapped (side "left", "right" or null)
//   { t: "ready" }             the console has loaded
//
// This first part is what the others share:
//   vesperLayer.given            what the app gave (above)
//   vesperLayer.post(message)    tell the app something
//   vesperLayer.root             the <html> element (class vesper-app, data-posture, data-fold)
//   vesperLayer.whenLoaded(run)  run(vesper) once the console has loaded, in the order asked
//   vesperApp                    what the app calls; a part adds its own (30-fit.js: fit, fold)
(function () {
  "use strict";
  var handlers = window.webkit && window.webkit.messageHandlers;
  var native = handlers && handlers.vesper;
  var root = document.documentElement;
  root.classList.add("vesper-app");
  root.setAttribute("data-posture", "plain");
  var waiting = [], loaded = false;
  window.vesperLayer = {
    given: window.__vesperNative || {},
    root: root,
    post: function (message) {
      try {
        if (native) native.postMessage(message);
      } catch (error) {}
    },
    whenLoaded: function (run) {
      if (!loaded) return void waiting.push(run);
      try {
        run(window.vesper);
      } catch (error) {}
    },
  };
  window.vesperApp = {};
  var tries = 0;
  var timer = setInterval(function () {
    var ready = window.vesper && window.vesper.loaded;
    if (!ready && ++tries < 600) return;
    clearInterval(timer);
    if (!ready) return;
    loaded = true;
    waiting.splice(0).forEach(function (run) {
      try {
        run(window.vesper);
      } catch (error) {}
    });
  }, 50);
})();
