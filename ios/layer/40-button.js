// The button: the app answers each press and release with a tap of the phone's haptics. Only
// the finger that pressed can let go: another finger lifting (off a case plate, say) is not the
// button's release.
(function () {
  "use strict";
  var post = window.vesperLayer.post;
  var pressed = null;
  function onButton(target) {
    return !!(target && target.closest && target.closest("#arcade, #menu-arcade, #game"));
  }
  document.addEventListener("pointerdown", function (event) {
    if (pressed !== null || event.button !== 0 || !onButton(event.target)) return;
    pressed = event.pointerId;
    post({ t: "press", down: true });
  }, true);
  function release(event) {
    if (pressed === null || event.pointerId !== pressed) return;
    pressed = null;
    post({ t: "press", down: false });
  }
  document.addEventListener("pointerup", release, true);
  document.addEventListener("pointercancel", release, true);
})();
