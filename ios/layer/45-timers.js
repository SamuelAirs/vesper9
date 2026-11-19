// In a game the timers' line shows only while a timer runs (20-play.css). "NO ACTIVE TIMERS"
// says nothing there, and in the first pictures from a Mac it sat on the button's edge. The
// console writes the line itself (web/main.js: a count first while one runs); this marks
// html.timers-running from what it says.
(function () {
  "use strict";
  var layer = window.vesperLayer;
  layer.whenLoaded(function () {
    var badge = document.getElementById("timer-badge");
    if (!badge) return;
    if (typeof MutationObserver !== "function") {
      // Nothing to watch with: the line stays as the console has it.
      layer.root.classList.add("timers-running");
      return;
    }
    var mark = function () {
      layer.root.classList.toggle("timers-running", /^\s*\d/.test(badge.textContent || ""));
    };
    new MutationObserver(mark).observe(badge, { childList: true, characterData: true, subtree: true });
    mark();
  });
})();
