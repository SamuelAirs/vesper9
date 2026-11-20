# Vesper 9 iPhone app: status

## Start here (2026-11-19 evening, written by the Clio chat Sam asked)

Sam, 2026-11-18: "Can you help me turn vesper 9 into an iPhone app?" and "I want this to be
super optimized for the duo". 2026-11-19: "Tapping on the phone back shouldn't do anything, as
that's an accessibility feature", "Spawn agents to work on the app as you see fit", "Yes, go
ahead with the changes", "Push once the engine changes are done", and of the five apps on no
sector (Tideline, Descent, Chronometer, Ephemeris, Atmosphere): "I think those five were just
bad or not fun". They stay retired; don't offer them again.

**What it is:** a small Swift shell around the console's own page. The engine already runs
without hardware (the browser simulator); the app shows that page in one full-screen web view,
so every game and instrument comes along and nothing is rewritten. The repo's `docs/IOS.md` is
the guide.

**Where:** worktree `C:\Users\ayers\vesper9-ios`, branch `ios-app`, **pushed** to
`SamuelAirs/vesper9` (public) on 2026-11-19. Cut from `codex/highbar-momentum` (the source the
Pi ran). The engine (`web/`, `vesper/catalog.*`) is changed only by things that are off unless
the app turns them on (an edition, a text floor); the Pi console and the browser simulator are
checked to be as before.

**Compiled and run on simulators (GitHub's Mac, Xcode 27):** the Swift compiled at the first
attempt with no warning. Run 1: the app in WebKit on the iPhone Duo's simulator, closed (the
page, the type, the plain-phone layouts, the handheld edition, the case plates, the readable
text, as in Chrome). Run 2 (`e7b010f`): the Duo's postures with a pretend fold on an iPad
(laptop, opened upright, book), laid out as the Chrome checks have them. Run 3 (`e0efdea`): the
closed Duo with the clock in its status column, The Stacks' books with no network, the book
without a status row, no timers' line on the button in a game. Sam has the runs' pictures in
the chat. The branch is at `4f3a7e6` (docs only after `e0efdea`).

**Checked on the PC (Chrome, not a phone):** seven browser checks, 1,964 checks, the Python
tests of this work, the engine's 1,666 JavaScript tests. Commands: `docs/IOS.md`, "Checks on
the PC". Their closed Duo now has its real status column.

**Never run:** a phone. Haptics, sound, the real fold, saves across launches.

## What the app has

- **iPhone Duo first:** the crease and hinge read as Boxset reads them. Crease across (part
  folded like a laptop, or opened and turned): every screen in two halves, nothing in the
  crease's band; a game's picture alone fills the upper half. Opened like a book: one window.
  Closed: an ordinary phone, 382 points wide beside the status column (84 points at the right
  of the outer display too). The clock and battery show in that column; other phones hide the
  status bar.
- **Case taps on screen** (Sam ruled out the phone's back): plates at the button's sides in a
  game, a CASE key elsewhere.
- **The lamps as light:** larger lamps, their colours in pools on the deck.
- **Every screen one screen on a plain phone** and the Duo closed.
- **A handheld edition:** six apps that need the Pi or its microphone are not shown; the
  console's words have handheld forms; Calibration has CASE PLATES.
- **Readable text:** a floor of 9 points in eighteen games, each one's layout following it.
- **The fifteen books** in The Stacks, offline.
- **The console's saves can be brought over** (`python ios/console-saves.py`; the file goes in
  Files > On My iPhone > VESPER-9). The newest are on the Pi in
  `releases/0c1bf13…/trial-data`; no copy is on the PC.

## Waiting on Sam

1. **The app's record:** bundle ID `com.samuelairs.vesper9` and an app named VESPER-9 in App
   Store Connect; then the four signing secrets on `SamuelAirs/vesper9` (the same four as his
   other apps). Then one push with `[testflight]` puts it on his phone.
2. ~~The Pi's backup of the console's newest saves.~~ Answered 2026-11-19: "Don't worry about
   adding saves". Withdrawn in `Chats/from-clio.md` (16:15); don't ask again.
3. **Small, his call:** seven older docs in the public repo name `C:\Users\ayers\...` paths
   (no secrets); six of the engine's installer tests fail on GitHub's Windows runner only (a
   short and a long spelling of its temp folder; not this work's). Offered, not done.

## The critic's review

`Critique 2026-11-19.md` in this folder. Done since: the text floor, the edition, the console's
words. Not done: Crawlspace, Supper Club and Light Trial are not on the floor's list; lists in
a game look tappable and are not; the hint strip in play mode sideways.

## Next step for a chat

Read the newest run of the iOS workflow on `ios-app` (`gh run list --branch ios-app`, `gh` at
`%LOCALAPPDATA%\Programs\gh\2.103.3\bin\gh.exe`; `gh run download <id>` for the pictures) and
look at every picture: five of the closed Duo, six of the Duo's postures on an iPad, two of an
iPad. Fix what they show. A fix to the pushed branch may be pushed (Sam's word covered the
push); a new App Store record, TestFlight or spending needs his word.

After his 1: a commit with `[testflight]` in its first line.

Later, each needing Swift that cannot be compiled here: haptics with meaning, timers that ring
when the app is closed, sound under the silent switch, speech on the phone, a widget.

## How the agents' rounds ran (2026-11-19), for the next one

Sam's word was "as you see fit". What worked: split the layer into numbered files first so
each agent owns its own; one git worktree and branch per agent, cut from `ios-app`
(`git worktree add -b ios-<x> ..\vesper9-ios-<x> ios-app`); a brief naming the files it owns,
the checks to run, and "do not commit, do not push"; rerun each one's checks and read its
pictures before committing its work; merge them in a separate `ios-next` worktree, rerun
everything, then fast-forward `ios-app` and remove the worktrees and branches. Round 1: five
Opus agents, about 1.3 million tokens. Round 2 (the engine): two, about 0.8 million. Book the
run in `Shared/PC schedule.md`.

## Traps

- Swift cannot be compiled on this PC: a push is the compile. Say "compiled" only of a green
  run, and "on the simulator" of its pictures.
- A new simulator on GitHub's Mac takes about three minutes to start and four to install the
  app; `simctl` now and then hangs. The picture steps limit every call and cannot fail a build.
- The Duo's simulator starts folded shut and nothing opens it: its inner display is black. The
  fold's layouts are pictured with a pretend fold (`-VesperFold across|down`,
  `-VesperHinge half`) on an iPad.
- `scripts/check.py` cannot finish on this PC: twelve Python test files need `aiohttp`, which
  no Python here has. GitHub's Regressions workflow runs them.
- Playwright is not installed in the repo: set `PLAYWRIGHT_PATH` to
  `%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright`,
  `TEST_BROWSER_BIN` to Chrome's exe, and `PYTHON=python` when running a check with `node`.
- Chrome knows nothing of the fold or the safe areas: the browser checks give them by hand
  (Sam's Duo: inner display 951 x 669, crease 455.5 to 495.5, status row 82 turned, status
  column 84 as a book and closed, home bar 34). Trust his recordings over the simulator.
- The page's own play mode also applies upright from 700 points wide (an iPad): the upright
  layout in `ios/layer/20-play.css` sets every property it sets. Keep the two in step.
- A new element in the button's row or the picture's margins meets the case plates: a check
  that taps or compares there must aim between plate and cap.
- The repo is public: Sam's saves (`console-saves.json`, any `vesper.sqlite3`) never go in it.
- The main checkout `C:\Users\ayers\vesper9` has uncommitted files from 2026-10-04
  (`docs/WORKLOG.md` and three untracked notes). They are not this work's: leave them.
- The Pi's console is shelved (service `vesper` disabled 2026-11-17); its folder
  `~/VESPER-9-v0.2.0-Claude` stays. Read it only; never change it.
