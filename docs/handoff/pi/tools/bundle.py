#!/usr/bin/env python3
"""Build a Pi test bundle: merge every open draft PR's head into one commit, in a scratch clone.

Usage: bundle.py SCRATCH_DIR   (run on the Pi; prints the merged commit and leaves it at SCRATCH_DIR)

It never touches the vesper9 checkout or live; deploy is a separate, deliberate step.
Known conflicts are resolved by rule and anything else stops the script:
  docs/WORKLOG.md                 keep both sides
  tests/games-gesture.test.mjs    fleet/tools/bundle-resolve-gesture.py
  vesper/catalog.json             sectors from HEAD (PR #11 owns the catalog; it is merged before the
                                  PRs that fight over it), sector entries without an app are dropped,
                                  Meridian joins MIND; web/apps/catalog.js is regenerated
  game id lists in two tests      union of both sides, then cut down to the apps the catalog still has
  docs/OPERATOR.md voice row      HEAD's row, minus apps the catalog no longer has
  docs/PROTOCOL.md, vesper/server.py, README.md, docs/ENGINE.md   keep both sides (additions)
  web/apps/registry.js            both imports; the factory list is the union of both sides
  apps no sector lists            placed by NEW_HOMES (The Stacks in TOOLS, Relay in MIND)
  other tests/*.test.mjs          the draft being merged wins over what is already there
"""
import json
import pathlib
import re
import subprocess
import sys

REPO = pathlib.Path.home() / "VESPER-9-v0.2.0-Claude" / "vesper9"
TOOLS = pathlib.Path(__file__).resolve().parent
ORDER = [16, 1, 2, 3, 5, 6, 11, 7, 8, 15, 17, 18, 4, 9, 10, 12, 14]  # platform (#16) first: every game draft builds on it; catalog owner (#11) before the catalog fights; the Outpost stack (#15, #17, #18) after its base (#8)
# Local work that is not a pull request yet, merged after the drafts: (repository, ref, label).
EXTRA = [(str(pathlib.Path.home() / "VESPER-9-v0.2.0-Claude" / "node2"), "pi/node-two-mics", "node2")]
EXTRA_PRS = {19}
SKIP_PRS = {2}  # Descent is on hold (Sam, 2026-10-02)  # published from the local node2 branch (claude/second-node-firmware-*), which is always newer
NEW_HOMES = {"library": "MIND", "relay": "MIND"}
MOVES = {}  # placements that override the drafts (none: the dashboard draft, #11, owns the layout and its tests)
HUNK = re.compile(r"<<<<<<< [^\n]*\n(.*?)=======\n(.*?)>>>>>>> [^\n]*\n", re.S)
GIT = ["git", "-c", "user.name=Claude (Pi)", "-c", "user.email=noreply@anthropic.com"]


def run(*args, cwd=None, check=True):
    result = subprocess.run(args, cwd=cwd, text=True, capture_output=True)
    if check and result.returncode:
        sys.exit(f"FAILED: {' '.join(args)}\n{result.stdout}{result.stderr}")
    return result


def rewrite(path, fix):
    text = path.read_text()
    new = HUNK.sub(fix, text)
    assert "<<<<<<<" not in new
    path.write_text(new)


def app_ids(work):
    return {a["id"] for a in json.loads((work / "vesper/catalog.json").read_text())["apps"]}


def ids_in(text):
    return re.findall(r"""["']([a-z]+)["']""", text)


def resolve(work, name):
    path = work / name
    if name == "docs/WORKLOG.md":
        rewrite(path, lambda m: m.group(1) + m.group(2))
    elif name == "tests/games-gesture.test.mjs":
        run(sys.executable, str(TOOLS / "bundle-resolve-gesture.py"), cwd=work)
    elif name == "vesper/catalog.json":
        # A three-way merge on the data, not the text: two drafts adding an app at the same place
        # interleave line by line. HEAD owns the sectors; settle() places apps that have none.
        base, ours, theirs = (json.loads(run("git", "show", f":{stage}:{name}", cwd=work).stdout) for stage in (1, 2, 3))
        by = lambda catalog: {a["id"]: a for a in catalog["apps"]}
        b, o, t = by(base), by(ours), by(theirs)
        apps = [a for a in ours["apps"] if not (a["id"] in b and a["id"] not in t)]  # theirs removed it
        for index, app in enumerate(apps):
            if app["id"] in t and t[app["id"]] != b.get(app["id"]) and app == b.get(app["id"]):
                apps[index] = t[app["id"]]                                          # only theirs changed it
        order = [a["id"] for a in theirs["apps"]]
        for app in theirs["apps"]:
            if app["id"] not in b and app["id"] not in o:                           # theirs added it
                before = [i for i in order[:order.index(app["id"])] if any(x["id"] == i for x in apps)]
                at = next(i for i, x in enumerate(apps) if x["id"] == before[-1]) + 1 if before else len(apps)
                apps.insert(at, app)
        merged = dict(ours, apps=apps)

        def three_way(b_, o_, t_):
            """Ours, plus whatever only theirs changed; dictionaries key by key."""
            if isinstance(o_, dict) and isinstance(t_, dict):
                b_ = b_ if isinstance(b_, dict) else {}
                out = dict(o_)
                for key in t_:
                    if key not in o_:
                        if key not in b_:
                            out[key] = t_[key]          # theirs added it
                    else:
                        out[key] = three_way(b_.get(key), o_[key], t_[key])
                for key in list(out):
                    if key in b_ and key not in t_ and o_.get(key) == b_.get(key):
                        del out[key]                    # theirs removed it, ours left it alone
                return out
            return t_ if t_ != b_ and o_ == b_ else o_

        for key in theirs:
            if key not in ("apps", "sectors"):
                merged[key] = three_way(base.get(key), ours.get(key, base.get(key)), theirs[key])
        # Apps theirs added to a page both sides have (e.g. High Bar on ARCADE) join that page.
        by_name = {s_["name"]: s_ for s_ in merged["sectors"]}
        base_pages = {s_["name"]: s_["apps"] for s_ in base["sectors"]}
        for sector in theirs["sectors"]:
            placed = {a for s_ in merged["sectors"] for a in s_["apps"]}
            if sector["name"] in by_name:
                for app in sector["apps"]:
                    if app not in base_pages.get(sector["name"], []) and app not in placed and any(a["id"] == app for a in merged["apps"]):
                        by_name[sector["name"]]["apps"].append(app)
        names = {s_["name"] for s_ in base["sectors"]} | {s_["name"] for s_ in merged["sectors"]}
        for index, sector in enumerate(theirs["sectors"]):  # a page theirs added (e.g. AFTER HOURS) goes where theirs put it
            if sector["name"] not in names:
                placed = {a for s_ in merged["sectors"] for a in s_["apps"]}
                sector = dict(sector, apps=[a for a in sector["apps"] if a not in placed])  # an app sits on one page
                if not sector["apps"]:
                    continue
                before = [s_["name"] for s_ in theirs["sectors"][:index]]
                at = max([i + 1 for i, s_ in enumerate(merged["sectors"]) if s_["name"] in before] or [len(merged["sectors"])])
                merged["sectors"].insert(at, sector)
        if (any("meridian" in s["apps"] for s in theirs["sectors"]) and not any("meridian" in s["apps"] for s in merged["sectors"])
                and any(s["name"] == "MIND" for s in merged["sectors"])):
            next(s for s in merged["sectors"] if s["name"] == "MIND")["apps"].insert(0, "meridian")
        path.write_text(json.dumps(merged, indent=2, ensure_ascii=False) + "\n")
    elif name == "web/apps/catalog.js":
        run("git", "checkout", "--ours", name, cwd=work)  # regenerated once catalog.json is settled
    elif name in ("tests/gesture-apps.test.mjs", "tests/test_catalog_sectors.py"):
        quote = '"' if name.endswith(".mjs") else "'"
        def games(m):
            if "GAMES" not in m.group(1) + m.group(2):  # another part of the file (a per-app note): keep both
                return m.group(1) + "".join(l + "\n" for l in m.group(2).splitlines() if l not in m.group(1).splitlines())
            ours, theirs = ids_in(m.group(1)), ids_in(m.group(2))
            merged = ours + [i for i in theirs if i not in ours]
            if name.endswith(".mjs"):
                merged = sorted(merged)
                body = ", ".join(quote + i + quote for i in merged)
                return f"  assert.deepEqual(GAMES.slice().sort(), [{body}]);\n"
            return "GAMES = [" + ", ".join(quote + i + quote for i in merged) + "]\n"
        rewrite(path, games)
    elif name == "docs/OPERATOR.md":
        rewrite(path, lambda m: m.group(1))
    elif name in ("docs/PROTOCOL.md", "docs/ENGINE.md", "README.md", "vesper/server.py"):
        # Additions on both sides (a new endpoint, a new command branch): keep both, HEAD's first.
        # server.py is then compiled and the Python suite decides whether that was right.
        rewrite(path, lambda m: m.group(1) + m.group(2))
    elif name == "web/apps/registry.js":
        # Imports: both sides. The FACTORIES list: ours, plus the names theirs added since the merge base
        # (so a name ours removed, like Helix, stays removed). Lines that are not part of the list (a comment,
        # an Object.assign adding more factories) are kept after it.
        base_text = run("git", "show", f":1:{name}", cwd=work, check=False).stdout
        base_list = re.search(r"const FACTORIES = \{(.*?)\};", base_text, re.S)
        base_names = set(re.findall(r"[A-Za-z_]\w*", base_list.group(1))) if base_list else set()
        listing = re.compile(r"^\s*[A-Za-z_][\w, ]*(\}\s*;)?\s*$")

        def registry(m):
            ours, theirs = m.group(1), m.group(2)
            if ours.lstrip().startswith("import") and theirs.lstrip().startswith("import"):
                return ours + "".join(l + "\n" for l in theirs.splitlines() if l not in ours.splitlines())
            closes = any(re.search(r"\}\s*;", l) for l in ours.splitlines() if listing.match(l))
            names, extra = [], []
            for line in ours.splitlines():
                if listing.match(line):
                    names += [n for n in re.findall(r"[A-Za-z_]\w*", line) if n not in names]
                elif line not in extra:
                    extra.append(line)
            for line in theirs.splitlines():
                if listing.match(line):
                    names += [n for n in re.findall(r"[A-Za-z_]\w*", line) if n not in names and n not in base_names]
                elif line not in extra:
                    extra.append(line)
            return "  " + ", ".join(names) + (" };" if closes else ",") + "\n" + "".join(l + "\n" for l in extra)
        rewrite(path, registry)
    elif name == "web/apps/utilities.js":
        run(sys.executable, str(TOOLS / "bundle-resolve-utilities.py"), cwd=work)
    elif name in ("web/main.js", "web/engine/input.js"):
        # The platform draft (#16, merged first) owns these and already carries the tap draft's knock
        # handling in a later form (sides, double-knock back). Where both sides edited, HEAD wins;
        # one-sided hunks keep the added lines.
        rewrite(path, lambda m: m.group(1) if m.group(1).strip() else m.group(2))
    elif name.startswith("tests/") and (name.endswith(".test.mjs") or name.endswith(".cjs")):
        # A shared test file where the platform draft (merged first) retimed a game's old tests and
        # the game's own draft replaced or removed them: the game's draft wins. The suite then decides.
        rewrite(path, lambda m: m.group(2))
    else:
        # Anywhere else: only a hunk with one empty side is settled by rule (one draft added lines
        # beside something the other touched); the added lines are kept. Two real edits stop the script.
        hunks = HUNK.findall(path.read_text())
        if not hunks or any(ours.strip() and theirs.strip() for ours, theirs in hunks):
            return False
        rewrite(path, lambda m: m.group(1) + m.group(2))
    return True


def settle(work):
    """After all merges: make the catalog, the generated file and the id lists agree."""
    path = work / "vesper/catalog.json"
    text = path.read_text()
    catalog = json.loads(text)
    ids = {a["id"] for a in catalog["apps"]}
    for sector in catalog["sectors"]:
        for app in sector["apps"]:
            if app not in ids:
                print(f"  catalog: dropping {app} from {sector['name']}")
                text = re.sub(r'\n\s*"%s",?(?=\n)' % re.escape(app), "", text, count=1)
    text = re.sub(r",(\s*\])", r"\1", text)
    catalog = json.loads(text)
    for app, home in MOVES.items():  # decided placements that override the drafts' own
        if any(s_["name"] == home for s_ in catalog["sectors"]) and any(a["id"] == app for a in catalog["apps"]):
            for sector in catalog["sectors"]:
                sector["apps"] = [a for a in sector["apps"] if a != app]
            next(s_ for s_ in catalog["sectors"] if s_["name"] == home)["apps"].append(app)
    seen = set()
    for sector in catalog["sectors"]:  # an app sits on one page: its first one (the dashboard draft's, earlier)
        repeats = [a for a in sector["apps"] if a in seen]
        if repeats:
            print(f"  catalog: {', '.join(repeats)} also on {sector['name']}; kept on the earlier page")
            sector["apps"] = [a for a in sector["apps"] if a not in seen]
        seen.update(sector["apps"])
    catalog["sectors"] = [sector for sector in catalog["sectors"] if sector["apps"]]
    text = json.dumps(catalog, indent=2, ensure_ascii=False) + "\n"
    path.write_text(text)
    placed = {a for s in catalog["sectors"] for a in s["apps"]}
    for app, home in NEW_HOMES.items():  # apps from drafts written against the old dashboard pages
        if app in ids and app not in placed:
            print(f"  catalog: placing {app} in {home}")
            block = re.search(r'"name": "%s".*?"apps": \[\n(.*?)\n(\s*)\]' % home, text, re.S)
            text = text[:block.end(1)] + ',\n        "%s"' % app + text[block.end(1):]
            placed.add(app)
    catalog = json.loads(text)
    path.write_text(text)
    print("  sectors:", [(s["name"], s["apps"]) for s in catalog["sectors"]])
    print("  apps in no sector:", sorted(ids - placed))
    gone = {"pulsar", "helix", "kiln"} - ids
    for name, quote in (("tests/gesture-apps.test.mjs", '"'), ("tests/test_catalog_sectors.py", "'")):
        p = work / name
        t = p.read_text()
        for app in gone:
            t = re.sub(r"(GAMES(?:\.slice\(\)\.sort\(\), | = )\[[^\]]*?)%s%s%s, ?" % (quote, app, quote), r"\1", t)
            t = re.sub(r"(GAMES(?:\.slice\(\)\.sort\(\), | = )\[[^\]]*?), ?%s%s%s\]" % (quote, app, quote), r"\1]", t)
        p.write_text(t)
    op = work / "docs/OPERATOR.md"
    t = op.read_text()
    if "helix" in gone:
        t = t.replace(" / snake", "").replace("snake / ", "").replace(", HELIX", "").replace("HELIX, ", "")
    if "pulsar" in gone:
        t = t.replace("rhythm / ", "").replace(" / rhythm", "").replace("PULSAR, ", "").replace(", PULSAR", "")
    op.write_text(t)
    # The tap draft's test holds 1.1 s for tap, tap, hold in a game; the platform draft made that hold
    # 1.6 s (PLAY_HOLD_EXTRA_MS). Until those two drafts agree, the bundle's copy of the test waits longer.
    knock_test, input_js = work / "tests/knock.test.mjs", work / "web/engine/input.js"
    if knock_test.exists() and "PLAY_HOLD_EXTRA_MS" in input_js.read_text():
        t = knock_test.read_text()
        if "h.router.knock({ peak: 7000 }); h.wait(1100);" in t:
            knock_test.write_text(t.replace("h.router.knock({ peak: 7000 }); h.wait(1100);", "h.router.knock({ peak: 7000 }); h.wait(1700);"))
            print("  tests/knock.test.mjs: in-game hold lengthened to match the platform draft")
    run(sys.executable, "scripts/build-catalog.py", cwd=work)
    run(sys.executable, "scripts/build-catalog.py", "--check", cwd=work)


def open_prs():
    """The open pull requests. gh needs Sam's desktop keyring, which is locked when he is away and makes
    gh hang; the repository is public, so the plain REST API answers without a login."""
    try:
        result = subprocess.run(["gh", "pr", "list", "--limit", "40", "--json", "number,headRefName,headRefOid,isDraft"],
                                cwd=REPO, text=True, capture_output=True, timeout=25, stdin=subprocess.DEVNULL)
        if result.returncode == 0 and result.stdout.strip():
            return json.loads(result.stdout)
    except subprocess.TimeoutExpired:
        pass
    import urllib.request
    with urllib.request.urlopen("https://api.github.com/repos/SamuelAirs/vesper9/pulls?state=open&per_page=100", timeout=30) as reply:
        return [{"number": pr["number"], "headRefName": pr["head"]["ref"], "headRefOid": pr["head"]["sha"], "isDraft": pr["draft"]}
                for pr in json.load(reply)]


def main():
    work = pathlib.Path(sys.argv[1])
    run("git", "fetch", "origin", cwd=REPO)
    prs = open_prs()
    heads = {p["number"]: p for p in prs}
    # A pull request whose branch is also local EXTRA work (the Pi publishes PR #19 through a bundle, so its
    # local branch is newer and already carries the merges) is taken from the local branch only.
    heads = {n: pr for n, pr in heads.items() if n not in EXTRA_PRS | SKIP_PRS}
    order = [n for n in ORDER if n in heads] + sorted(n for n in heads if n not in ORDER)
    run("rm", "-rf", str(work))
    run("git", "clone", "-q", "--shared", "--no-checkout", str(REPO), str(work))
    run("git", "fetch", "-q", str(REPO), "refs/remotes/origin/*:refs/remotes/src/*", cwd=work)
    extras = []
    for index, number in enumerate(order):
        pr = heads[number]
        ref = "src/" + pr["headRefName"]
        if index == 0:
            run("git", "checkout", "-q", "--detach", ref, cwd=work)
            print(f"#{number} {pr['headRefOid'][:7]} base")
            continue
        run(*GIT, "merge", "--no-edit", ref, cwd=work, check=False)
        status = run("git", "status", "--porcelain", cwd=work).stdout.splitlines()
        conflicts = sorted({line[3:] for line in status if line[:2] in ("UU", "AA", "DU", "UD")})
        notes = []
        for name in conflicts:
            if not resolve(work, name):
                sys.exit(f"#{number}: no rule for a conflict in {name}; resolve by hand in {work}")
            run("git", "add", name, cwd=work)
            notes.append(name)
        if conflicts:
            run(*GIT, "commit", "-q", "--no-edit", cwd=work)
        print(f"#{number} {pr['headRefOid'][:7]} merged" + (f" (resolved: {', '.join(notes)})" if notes else ""))
    for repository, ref, label in EXTRA:
        if not pathlib.Path(repository).exists():
            continue
        run("git", "fetch", "-q", repository, f"{ref}:refs/remotes/extra/{label}", cwd=work)
        commit = run("git", "rev-parse", "--short", f"extra/{label}", cwd=work).stdout.strip()
        run(*GIT, "merge", "--no-edit", f"extra/{label}", cwd=work, check=False)
        status = run("git", "status", "--porcelain", cwd=work).stdout.splitlines()
        conflicts = sorted({line[3:] for line in status if line[:2] in ("UU", "AA", "DU", "UD")})
        for name in conflicts:
            if not resolve(work, name):
                sys.exit(f"{label}: no rule for a conflict in {name}; resolve by hand in {work}")
            run("git", "add", name, cwd=work)
        if conflicts:
            run(*GIT, "commit", "-q", "--no-edit", cwd=work)
        print(f"{label} {commit} merged" + (f" (resolved: {', '.join(conflicts)})" if conflicts else ""))
        extras.append(f"{label}@{commit}")
    settle(work)
    if run("git", "status", "--porcelain", cwd=work).stdout.strip():
        run("git", "add", "-A", cwd=work)
        run(*GIT, "commit", "-q", "-m", "Pi test bundle: settle the catalog, generated file and game lists", cwd=work)
    head = run("git", "rev-parse", "--short", "HEAD", cwd=work).stdout.strip()
    (work / ".bundle-heads").write_text("\n".join(f"{n} {heads[n]['headRefName']} {heads[n]['headRefOid'][:7]}" for n in order) + "\n")
    print("BUNDLE", head, "=", " ".join(f"#{n}@{heads[n]['headRefOid'][:7]}" for n in order), *extras)


main()
