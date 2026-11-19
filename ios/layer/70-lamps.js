// The lamps as light: each lamp's colour also lights the surface around it (70-lamps.css). This
// part only passes the lamps' values on as CSS variables, on the few elements that draw the
// light, whenever the console paints the lamps; it has no animation and runs nothing per frame.
//
// The colour is the page's own: main.js paints a lamp rgb(values) exactly as the leds event
// gives them (the lamp level setting is already in those values: the light director scales them
// before they are sent) and the board's pip from the director's boardDesired. Here each colour is
// split into its hue at full strength ("r g b") and how bright it is (0 to 1, the largest of the
// three over 255), so a glow drawn with that hue at a strength times that brightness is the lamp's
// own colour at that strength, and a dim lamp gives a faint glow.
//
// Set, as plain numbers, on #console, .physical-lights, .instrument-bar and .control-deck:
//   --lamp-0 .. --lamp-3, --lamp-b          hue "r g b" (lamps I to IV, the board's pip)
//   --lamp-0-a .. --lamp-3-a, --lamp-b-a    brightness 0 to 1 (0: off, or the lamp not shown)
// on .physical-lights, where each lamp's centre is (in pixels, from its top left; measured only
// when the layout changes):   --lamp-0-x, --lamp-0-y .. --lamp-b-x, --lamp-b-y
// on .instrument-bar, the same from its own top left:   --lamp-0-bx, --lamp-0-by ..
// on each lamp, its own:   --glow, --glow-a, and data-lit while it is on
// on <html>:   data-lamps="3" or "4", how many lamps the node shows
(function () {
  "use strict";
  var layer = window.vesperLayer, root = layer.root;

  layer.whenLoaded(function (vesper) {
    var byId = function (id) { return document.getElementById(id); };
    var frame = byId("console"), lights = document.querySelector(".physical-lights");
    var bar = document.querySelector(".instrument-bar"), deck = document.querySelector(".control-deck");
    var lamps = [byId("lamp-0"), byId("lamp-1"), byId("lamp-2"), byId("lamp-3")], pip = byId("lamp-board");
    if (!frame || !lights || !lamps[0]) return;
    var hosts = [frame, lights, bar, deck].filter(Boolean);
    var shown = ""; // what was last set, so an unchanged frame writes nothing

    function light(rgb) {
      var top = Math.max(rgb[0] || 0, rgb[1] || 0, rgb[2] || 0);
      if (!(top > 0)) return { hue: "0 0 0", a: "0" };
      var k = 255 / top;
      return {
        hue: Math.round(rgb[0] * k) + " " + Math.round(rgb[1] * k) + " " + Math.round(rgb[2] * k),
        a: String(Math.round((top / 255) * 1000) / 1000),
      };
    }
    function count() {
      try { return vesper.lampCount(); } catch (error) { return lamps[3] && !lamps[3].hidden ? 4 : 3; }
    }
    // The values as main.js reads them from an event or the state (every physical lamp).
    function valuesOf(e) {
      try { if (typeof vesper.physicalLeds === "function") return vesper.physicalLeds(e); } catch (error) {}
      return e && (Array.isArray(e.lamps) ? e.lamps : (e.lamps && e.lamps.values) || e.leds || e.values);
    }
    var current = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    function paint(values) {
      // As lightVisual: only nine or twelve values are a frame; a lamp past their count is off.
      if (Array.isArray(values) && (values.length === 9 || values.length === 12)) {
        current = values.slice();
      }
      var n = count(), each = [], board = [0, 0, 0];
      for (var i = 0; i < 4; i++) {
        var on = i < current.length / 3 && !(lamps[i] && lamps[i].hidden);
        each.push(light(on ? current.slice(i * 3, i * 3 + 3) : [0, 0, 0]));
      }
      try {
        var rgb = vesper.lights && vesper.lights.boardDesired;
        if (pip && !pip.hidden && vesper.hasBoardLed() && Array.isArray(rgb)) board = rgb;
      } catch (error) {}
      each.push(light(board));
      var key = n + "|" + each.map(function (one) { return one.hue + "/" + one.a; }).join("|");
      if (key === shown) return;
      shown = key;
      if (root.getAttribute("data-lamps") !== String(n)) root.setAttribute("data-lamps", String(n));
      ["0", "1", "2", "3", "b"].forEach(function (name, i) {
        hosts.forEach(function (host) {
          host.style.setProperty("--lamp-" + name, each[i].hue);
          host.style.setProperty("--lamp-" + name + "-a", each[i].a);
        });
        var lamp = i < 4 ? lamps[i] : pip;
        if (!lamp) return;
        lamp.style.setProperty("--glow", each[i].hue);
        lamp.style.setProperty("--glow-a", each[i].a);
        if (each[i].a !== "0") lamp.setAttribute("data-lit", "");
        else lamp.removeAttribute("data-lit");
      });
    }

    // Where each lamp's centre is, for the light around it. Only when the layout changes: the
    // window, the fold, play starting or ending, an instrument opening, a lamp shown or hidden.
    var pending = false;
    function place() {
      pending = false;
      var own = lights.getBoundingClientRect();
      var barBox = bar ? bar.getBoundingClientRect() : null;
      var barShown = barBox && barBox.width > 0 && barBox.height > 0;
      ["0", "1", "2", "3", "b"].forEach(function (name, i) {
        var lamp = i < 4 ? lamps[i] : pip;
        if (!lamp || lamp.hidden) return;
        var box = lamp.getBoundingClientRect();
        if (!box.width) return;
        var x = box.left + box.width / 2, y = box.top + box.height / 2;
        lights.style.setProperty("--lamp-" + name + "-x", Math.round((x - own.left) * 10) / 10 + "px");
        lights.style.setProperty("--lamp-" + name + "-y", Math.round((y - own.top) * 10) / 10 + "px");
        if (barShown) {
          bar.style.setProperty("--lamp-" + name + "-bx", Math.round((x - barBox.left - bar.clientLeft) * 10) / 10 + "px");
          bar.style.setProperty("--lamp-" + name + "-by", Math.round((y - barBox.top - bar.clientTop) * 10) / 10 + "px");
        }
      });
    }
    function placeSoon() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(place);
    }
    window.addEventListener("resize", placeSoon);
    if (window.MutationObserver) {
      var watch = new MutationObserver(function () { placeSoon(); paint(); });
      watch.observe(frame, { attributes: true, attributeFilter: ["class"] });
      [lamps[3], pip, byId("application"), byId("dashboard")].forEach(function (one) {
        if (one) watch.observe(one, { attributes: true, attributeFilter: ["hidden"] });
      });
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(placeSoon, function () {});

    // main.js listened first, so by now it has painted the lamps from the same event.
    vesper.bridge.addEventListener("event", function (event) {
      var e = event.detail || {};
      if (e.type === "leds" || e.type === "state") paint(valuesOf(e));
      else if (e.type === "node_status" && (e.leds || e.lamps)) paint(valuesOf(e));
      else if (e.type === "board_led" || e.type === "device") paint();
    });
    paint(valuesOf(vesper.state || {}));
    place();
  });
})();
