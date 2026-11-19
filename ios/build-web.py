#!/usr/bin/env python3
"""Build the page the iPhone app shows.

It is the standalone console (scripts/build-demo.py: the engine, every app and the simulated
node in one file) with the app's own layer added to its <head>: every .css file in ios/layer/
after the page's style, every .js file there before the console's code, each in the order of
its name. Written to ios/Web/index.html, which the app carries in its bundle and which is not
kept in git.

Whatever else rides in the app's Web folder is made by the scripts in ios/extras/: each has a
`build(folder)` that writes its files beside the page (ios/extras/README.md).

    python3 ios/build-web.py [destination]
"""
import runpy
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LAYER = ROOT / "ios" / "layer"
EXTRAS = ROOT / "ios" / "extras"


def parts(suffix):
    files = sorted(LAYER.glob("*" + suffix))
    if not files:
        raise ValueError("ios/layer has no " + suffix + " files")
    return "\n".join("/* " + f.name + " */\n" + f.read_text(encoding="utf-8") for f in files)


def build(destination=None):
    destination = Path(destination) if destination else ROOT / "ios" / "Web" / "index.html"
    destination.parent.mkdir(parents=True, exist_ok=True)
    runpy.run_path(str(ROOT / "scripts" / "build-demo.py"))["build"](destination)
    html = destination.read_text(encoding="utf-8")
    if html.count('<meta name="viewport"') != 1:
        raise ValueError("Expected exactly one viewport tag (the layer rewrites it)")
    if "VESPER_STANDALONE" not in html:
        raise ValueError("The standalone console's code is missing")
    css, js = parts(".css"), parts(".js")
    if "</style" in css:
        raise ValueError("The layer's CSS must not close its own <style>")
    layer = (
        '<style id="vesper-app-css">\n' + css + "\n</style>\n"
        '<script id="vesper-app-js">\n' + js.replace("</script", "<\\/script") + "\n</script>\n"
    )
    # The first </head> is the page's own: the console's code comes after it, in <body>.
    head_end = html.index("</head>")
    destination.write_text(html[:head_end] + layer + html[head_end:], encoding="utf-8")
    for extra in sorted(EXTRAS.glob("*.py")):
        runpy.run_path(str(extra))["build"](destination.parent)
    print(destination)


if __name__ == "__main__":
    build(sys.argv[1] if len(sys.argv) > 1 else None)
