// The Stacks' books, carried in the app. On the console The Stacks asks the Pi's service for the
// shelf (get("library")) and for one chapter at a time (get("library/<id>/<chapter>")). The app
// has no service: ios/extras/books.py wrote what the service answers for the books that ship
// with the console as scripts in the Web folder: books/shelf.js (the shelf, and where each
// book's parts begin) and books/<id>/<first chapter>.js (a run of chapters). Each is one call,
// window.__vesperBooks(its file, { path: answer, ... }). The page is opened from a file and
// cannot fetch, so a script is added when one of its answers is first asked for, and kept.
// Every other path goes to the console's own bridge untouched.
//
// What needs the service or the network ends in a line that says so: fetching more classics
// (The Stacks' own "could not be fetched" notice) and importing from a USB drive.
(function () {
  "use strict";
  var layer = window.vesperLayer;
  var SHELF = "books/shelf.js";
  var CHAPTER = /^library\/([0-9a-f]{16})\/([0-9]{1,5})$/;
  var KEPT = 3;                  // parts kept besides the shelf: what is read, and what is next
  var NO_FETCH = "the app reads only the books built into it";
  var NO_IMPORT = "the app reads only the books built into it, not a USB drive";
  var files = {};                // file -> { path: answer }
  var order = [];                // the parts' files, oldest first
  var loading = {};              // file -> its promise

  window.__vesperBooks = function (name, answers) {
    name = String(name);
    files[name] = answers || {};
    if (name === SHELF) return;
    order = order.filter(function (f) { return f !== name; });
    order.push(name);
    while (order.length > KEPT) delete files[order.shift()];
  };

  function script(name) {
    if (files[name]) return Promise.resolve(files[name]);
    if (loading[name]) return loading[name];
    loading[name] = new Promise(function (resolve, reject) {
      var tag = document.createElement("script");
      tag.src = name;
      tag.charset = "utf-8";
      tag.async = true;
      tag.onload = tag.onerror = function () {
        tag.remove();
        delete loading[name];
        if (files[name]) resolve(files[name]);
        else reject(new Error("missing " + name));
      };
      document.head.appendChild(tag);
    });
    return loading[name];
  }

  // Each caller gets its own copy, as each answer from the service is new: The Stacks marks
  // the shelf's items as it fetches them.
  function copy(value) {
    return JSON.parse(JSON.stringify(value));
  }

  // The bridge's own words when the service has no answer: "Could not load <path>".
  function load(path) {
    var failed = new Error("Could not load " + path);
    if (path === "library") {
      return script(SHELF).then(function (shelf) {
        if (!shelf.library) throw failed;
        return copy(shelf.library);
      }, function () { throw failed; });
    }
    var m = CHAPTER.exec(path);
    if (!m) return Promise.reject(failed);
    var book = m[1], index = parseInt(m[2], 10), key = "library/" + book + "/" + index;
    return script(SHELF).then(function (shelf) {
      var starts = (shelf.parts || {})[book] || [], first = -1;
      for (var i = 0; i < starts.length && starts[i] <= index; i++) first = starts[i];
      if (first < 0) throw failed;
      return script("books/" + book + "/" + first + ".js");
    }).then(function (part) {
      if (!part.hasOwnProperty(key)) throw failed;
      return copy(part[key]);
    }, function () { throw failed; });
  }

  layer.whenLoaded(function (vesper) {
    var bridge = vesper && vesper.bridge;
    if (!bridge || typeof bridge.get !== "function") return;
    var get = bridge.get, command = bridge.command;
    bridge.get = function (path) {
      if (path === "library" || (typeof path === "string" && path.indexOf("library/") === 0)) return load(path);
      return get.apply(bridge, arguments);
    };
    bridge.command = function (name) {
      // More classics come from the web on the console; here The Stacks' own notice says why not.
      if (name === "library_fetch") {
        setTimeout(function () {
          if (typeof bridge.emit === "function") bridge.emit({ type: "library", op: "fetch", ok: false, error: NO_FETCH });
        }, 0);
        return Promise.resolve({ accepted: true });
      }
      // The Stacks shows this as "The import did not start: ...".
      if (name === "library_import") return Promise.reject(new Error(NO_IMPORT));
      return command.apply(bridge, arguments);
    };
  });
})();
