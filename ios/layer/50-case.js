// The case: the console's second input. On the console a knock on its case is heard by the node's
// microphones (the engine calls it a case tap). The phone has no case to knock, so the page draws
// one: two case plates beside the button while a game runs (the left one knocks on the left, the
// right one on the right), and a CASE key beside the button on the dashboard, in an instrument and
// in the system menu (a knock with no side: "CASE TAP: PREVIOUS", two of them go back).
// Each knock goes to the console as the keyboard's K, J and L do (vesper.softwareKnock), and the app
// is told, for its haptic:
//   { t: "knock", side: "left" | "right" | null }
// A plate never presses the button and the button never knocks; the button and a plate can be held
// at once (Twinbeat plays the two together).
(function () {
  "use strict";
  var layer = window.vesperLayer, given = layer.given, post = layer.post, root = layer.root;

  // A knock: drawn as a knuckle and the two rings it sends through the case.
  var GLYPH =
    '<svg class="case-glyph" viewBox="0 0 24 24" aria-hidden="true">' +
    '<circle cx="5" cy="12" r="2.6"/><path d="M10 6.5a8 8 0 0 1 0 11"/><path d="M15 3.5a12.5 12.5 0 0 1 0 17"/></svg>';

  function make(kind, side, words, label) {
    var e = document.createElement("button");
    e.type = "button";
    e.tabIndex = -1;
    e.className = "case-pad " + kind + (side ? " case-" + side : "");
    e.setAttribute("data-side", side || "");
    e.setAttribute("aria-label", label);
    e.innerHTML = GLYPH + '<span class="case-word">' + words + "</span>";
    return e;
  }

  function knock(side) {
    post({ t: "knock", side: side || null });
    var vesper = window.vesper;
    try {
      if (vesper && vesper.softwareKnock) vesper.softwareKnock(side || null);
    } catch (error) {}
  }

  // Which pointer holds which pad. The pad keeps its pointer (pointer capture), and the pad's
  // release is stopped on the window, before 40-button.js sees it: that part lets go of the button
  // on any release, and a finger lifted off a plate must not let go of a button another finger
  // still holds.
  var held = {};
  function down(event) {
    var pad = event.target && event.target.closest && event.target.closest(".case-pad");
    if (!pad || event.button !== 0) return;
    event.preventDefault();
    try {
      pad.setPointerCapture(event.pointerId);
    } catch (error) {}
    held[event.pointerId] = pad;
    pad.classList.add("down");
    knock(pad.getAttribute("data-side"));
  }
  function up(event) {
    var pad = held[event.pointerId];
    if (!pad) return;
    delete held[event.pointerId];
    event.stopPropagation();
    var still = false;
    Object.keys(held).forEach(function (id) {
      if (held[id] === pad) still = true;
    });
    if (!still) pad.classList.remove("down");
  }
  window.addEventListener("pointerup", up, true);
  window.addEventListener("pointercancel", up, true);

  // Sideways play: the game's 16:9 picture is letterboxed in the stage (which is the button).
  // Where it leaves margins of 44 points or more at its left and right (phones), those are the
  // plates. Where it fills the width (the Duo opened like a book), the plates sit at the two ends
  // of the free band below it; if that band is too thin, the picture moves up so the band is the
  // whole of the free height. Only if there is no free room at all do they lie over the picture's
  // lower corners. The page's play mode runs its stage down into the home bar's area (the Duo
  // opened like a book); a plate stops above it (--case-lift), where a touch is not a swipe home.
  var MIN = 44; // points
  var windowWidth = given.fold && given.fold.window ? given.fold.window[0] : 0;
  function scale() {
    return windowWidth > 0 ? window.innerWidth / windowWidth : 1;
  }
  var canvas = null, mode = "";
  function place() {
    if (!canvas) return;
    var style = root.style, box = canvas.getBoundingClientRect();
    var playing = document.body.classList.contains("playing");
    var next = "";
    if (playing && box.width > box.height && window.innerWidth > window.innerHeight) {
      var stage = canvas.parentNode.getBoundingClientRect();
      var homeBar = parseFloat(getComputedStyle(root).getPropertyValue("--sab")) || 0;
      var bottom = Math.min(box.bottom, window.innerHeight - homeBar);
      var k = Math.min(box.width / 960, box.height / 540), pw = 960 * k, ph = 540 * k;
      var side = (box.width - pw) / 2, min = MIN * scale();
      var under = bottom - (box.top + (box.height + ph) / 2), underTop = bottom - (box.top + ph);
      style.setProperty("--case-lift", Math.max(0, Math.ceil(stage.bottom - bottom)) + "px");
      if (side >= min && bottom - box.top >= min) {
        next = "sides";
        style.setProperty("--case-side", Math.floor(side) + "px");
      } else if (under >= min) {
        next = "below";
        style.setProperty("--case-below", Math.floor(under) + "px");
      } else if (underTop >= min) {
        next = "below-top";
        style.setProperty("--case-below", Math.floor(underTop) + "px");
      } else next = "over";
    }
    if (next !== mode) {
      mode = next;
      if (mode) root.setAttribute("data-case", mode);
      else root.removeAttribute("data-case");
    }
  }

  function build() {
    var deck = document.querySelector(".control-deck"), arcade = document.getElementById("arcade");
    if (deck && arcade) {
      var key = make("case-key", null, "CASE", "Case tap: previous; two quick taps go back");
      arcade.parentNode.insertBefore(key, arcade.nextSibling);
      deck.appendChild(make("case-plate", "left", "CASE", "Case tap on the left"));
      deck.appendChild(make("case-plate", "right", "CASE", "Case tap on the right"));
    }
    var switchButton = document.getElementById("menu-arcade");
    if (switchButton)
      switchButton.parentNode.insertBefore(make("case-key", null, "CASE", "Case tap: previous; two quick taps go back"), switchButton.nextSibling);
    document.addEventListener("pointerdown", down, true);

    canvas = document.getElementById("game");
    if (canvas && window.ResizeObserver) new ResizeObserver(place).observe(canvas);
    if (window.MutationObserver) new MutationObserver(place).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    window.addEventListener("resize", place);
    place();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();

  // The app says the window's size in points with every fold; a plate's 44 points are counted in it.
  var fold = window.vesperApp.fold;
  if (fold) {
    window.vesperApp.fold = function (told) {
      if (told && told.window && told.window.length === 2) windowWidth = told.window[0];
      fold(told);
      place();
    };
  }
})();
