// The button: the app answers each press and release with a tap of the phone's haptics.
(function () {
  "use strict";
  var layer = window.vesperLayer, given = layer.given, post = layer.post, root = layer.root;

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
})();
