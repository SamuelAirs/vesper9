#!/usr/bin/env python3
"""Build the page the iPhone app shows.

It is the standalone console (scripts/build-demo.py: the engine, every app and the simulated
node in one file) with the app's own layer from ios/layer/ added to its <head>: app.css after
the page's style, app.js before the console's code. Written to ios/Web/index.html, which the
app carries in its bundle and which is not kept in git.

    python3 ios/build-web.py [destination]
"""
import runpy
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LAYER = ROOT / "ios" / "layer"


def build(destination=None):
    destination = Path(destination) if destination else ROOT / "ios" / "Web" / "index.html"
    destination.parent.mkdir(parents=True, exist_ok=True)
    runpy.run_path(str(ROOT / "scripts" / "build-demo.py"))["build"](destination)
    html = destination.read_text(encoding="utf-8")
    if html.count('<meta name="viewport"') != 1:
        raise ValueError("Expected exactly one viewport tag (app.js rewrites it)")
    if "VESPER_STANDALONE" not in html:
        raise ValueError("The standalone console's code is missing")
    css = (LAYER / "app.css").read_text(encoding="utf-8")
    js = (LAYER / "app.js").read_text(encoding="utf-8")
    if "</style" in css:
        raise ValueError("app.css must not close its own <style>")
    layer = (
        '<style id="vesper-app-css">\n' + css + "\n</style>\n"
        '<script id="vesper-app-js">\n' + js.replace("</script", "<\\/script") + "\n</script>\n"
    )
    # The first </head> is the page's own: the console's code comes after it, in <body>.
    head_end = html.index("</head>")
    destination.write_text(html[:head_end] + layer + html[head_end:], encoding="utf-8")
    print(destination)


if __name__ == "__main__":
    build(sys.argv[1] if len(sys.argv) > 1 else None)
