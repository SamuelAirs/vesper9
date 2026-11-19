// Last: once the console has loaded, say so, and open the app named at launch (the build's
// pictures).
(function () {
  "use strict";
  var layer = window.vesperLayer;
  layer.whenLoaded(function (vesper) {
    layer.post({ t: "ready" });
    if (layer.given.launch) vesper.launch(String(layer.given.launch));
  });
})();
