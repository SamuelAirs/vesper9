// The saves: the app's copy of them, and the console's own brought over.
(function () {
  "use strict";
  var layer = window.vesperLayer, given = layer.given, post = layer.post, root = layer.root;

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

  // What was brought over, said once the console is up.
  layer.whenLoaded(function (vesper) {
    if (brought) vesper.toast("CONSOLE SAVES BROUGHT OVER / " + brought.scores + " BESTS / " + brought.progress + " GAMES");
  });
})();
