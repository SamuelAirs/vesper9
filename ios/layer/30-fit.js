// The viewport and the fold: how large the page is laid out, and how the phone is held.
(function () {
  "use strict";
  var layer = window.vesperLayer, given = layer.given, post = layer.post, root = layer.root;

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

  window.vesperApp.fit = fit;
  window.vesperApp.fold = fold;
})();
