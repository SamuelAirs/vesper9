// VESPER-9 on iPhone: what the page needs to live inside the app's web view. ios/build-web.py
// puts this file in the page's <head>, so it runs before the console's own code. Nothing here
// changes a game: it keeps the saves, fits the viewport, and tells the app when the button moves.
//
// The app (ios/Vesper9/Console.swift) gives the page, before any of it runs:
//   window.__vesperNative = { saved: { key: text, ... }, launch: "app id" or null }
// and listens on window.webkit.messageHandlers.vesper for:
//   { t: "saves", items }      every saved item, once at start
//   { t: "save", key, value }  one item changed
//   { t: "remove", key }  { t: "clear" }
//   { t: "press", down }       the on-screen button or the game was pressed or let go
//   { t: "ready" }             the console has loaded
(function () {
  "use strict";
  var handlers = window.webkit && window.webkit.messageHandlers;
  var native = handlers && handlers.vesper;
  var given = window.__vesperNative || {};
  function post(message) {
    try {
      if (native) native.postMessage(message);
    } catch (error) {}
  }
  document.documentElement.classList.add("vesper-app");

  // Saves. The console keeps them in the web view's localStorage; the app keeps a copy of every
  // item in its own file as well. The web view's copy is the one in use. The app's copy only
  // fills in what is missing here (iOS emptied the web view's storage, or the app was restored),
  // so an older copy never replaces newer progress.
  var store = null;
  try {
    store = window.localStorage;
    var saved = given.saved || {};
    Object.keys(saved).forEach(function (key) {
      if (typeof saved[key] === "string" && store.getItem(key) === null) store.setItem(key, saved[key]);
    });
    var items = {};
    for (var i = 0; i < store.length; i++) items[store.key(i)] = store.getItem(store.key(i));
    post({ t: "saves", items: items });
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
  // page is laid out at the display's own size. The app calls fit(width, height) with the web
  // view's real size in points whenever that changes, and from then on only the app's numbers
  // count. Until its first call the size is taken from the screen (never from the page's own
  // width, which this changes: the two would chase each other).
  var NEED_W = 700, NEED_H = 400;
  var viewport = document.querySelector('meta[name="viewport"]');
  var current = "", sized = false;
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
    if (width > height && (width < NEED_W || height < NEED_H))
      wide = "width=" + Math.ceil(Math.max(NEED_W, (width * NEED_H) / height));
    var content = wide + ", viewport-fit=cover, user-scalable=no";
    if (content !== current) {
      current = content;
      viewport.setAttribute("content", content);
    }
  }
  fit();
  window.addEventListener("resize", function () { fit(); });
  window.addEventListener("orientationchange", function () { setTimeout(fit, 60); });

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

  // Once the console has loaded: say so, and open the app named at launch (the build's pictures).
  var tries = 0;
  var waiting = setInterval(function () {
    var loaded = window.vesper && window.vesper.loaded;
    if (!loaded && ++tries < 600) return;
    clearInterval(waiting);
    if (!loaded) return;
    post({ t: "ready" });
    if (given.launch) {
      try {
        window.vesper.launch(String(given.launch));
      } catch (error) {}
    }
  }, 50);

  window.vesperApp = { fit: fit };
})();
