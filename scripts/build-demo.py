#!/usr/bin/env python3
"""Bundle this project's simple named ES modules into a self-contained simulator.

No dependency downloads, runtime compiler, or remote assets. This intentionally
supports the syntax used in web/, not arbitrary third-party JavaScript.
"""
import json
import re
import runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
IMPORT = re.compile(r"^import\s*\{([^}]+)\}\s*from\s*['\"]([^'\"]+)['\"];?\s*", re.M)
EXPORT = re.compile(r"\bexport\s+(?:async\s+)?(?:class|function|const|let|var)\s+([A-Za-z_$][\w$]*)")


def build(destination=None):
    runpy.run_path(str(ROOT / "scripts/build-catalog.py"))["build"]()
    modules = []
    for path in sorted(WEB.rglob("*.js")):
        source = path.read_text()
        names = EXPORT.findall(source)
        def resolve(match):
            target = (path.parent / match.group(2)).resolve().relative_to(WEB.resolve()).as_posix()
            bindings = re.sub(r"\s+as\s+", ":", match.group(1))
            return "const {" + bindings + "}=__load(" + json.dumps(target) + ");\n"
        source = IMPORT.sub(resolve, source)
        source = re.sub(r"\bexport\s+(?=(?:async\s+)?(?:class|function|const|let|var)\b)", "", source)
        modules.append(json.dumps(path.relative_to(WEB).as_posix()) + ":(exports)=>{\n" + source + "\nObject.assign(exports,{" + ",".join(names) + "});\n}")
    bundle = "window.VESPER_STANDALONE=true;\n(()=>{const __modules={" + ",\n".join(modules) + "};const __cache={};function __load(id){if(!__cache[id]){const exports={};__cache[id]=exports;__modules[id](exports);}return __cache[id];}__load('main.js');})();"
    html = (WEB / "index.html").read_text()
    html, count = re.subn(r'<link\s+rel="stylesheet"\s+href="/style.css"\s*/?>', lambda _: '<style>\n' + (WEB / "style.css").read_text() + '\n</style>', html)
    if count != 1:
        raise ValueError("Expected exactly one local stylesheet")
    html = html.replace('<script type="module" src="/main.js"></script>', '<script>\n' + bundle.replace('</script', '<\\/script') + '\n</script>')
    destination = destination or ROOT / "VESPER-9-Simulator.html"
    destination.write_text(html)
    print(destination)


if __name__ == "__main__":
    build()
