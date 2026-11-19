# VESPER-9 on iPhone

A native app for iPhone, iPhone Duo and iPad that carries the console's own page: the same
engine, games and instruments as the browser simulator, with the node drawn on screen. It is
built first for iPhone Duo.

## Where it stands (2026-11-18)

- **Written and checked on the PC:** the page the app shows and its layouts, in Chrome at
  iPhone, iPhone Duo and iPad sizes, with the Duo's fold given as the app gives it
  (`tests/ios-page-browser.cjs`, 134 checks, pictures in the test output), and the tool that
  reads the console's saves (`tests/test_ios_page.py`).
- **Written, never compiled:** the Swift shell (`ios/Vesper9/`), the project (`ios/project.yml`)
  and the build workflow (`.github/workflows/ios.yml`). No Mac has seen them. The first push of
  this branch to GitHub is their first compile. The fold and hinge calls are the ones Boxset
  already uses on Sam's Duo.
- **Not done at all:** nothing has run in WebKit, in a simulator or on a phone. Haptics, sound,
  the real fold and safe areas, and saved progress across launches are untried.

## What the app is

| Part | What it does |
| --- | --- |
| `ios/build-web.py` | Builds the page: the standalone console (`scripts/build-demo.py`) with the app's layer added to its head. Writes `ios/Web/index.html` (not in git). |
| `ios/layer/app.css` | The app's layouts, all under `html.vesper-app`. The console on the Pi and the browser simulator never load it. |
| `ios/layer/app.js` | Keeps the saves, fits the page to the display and its fold, tells the app when the button moves. |
| `ios/Vesper9/Console.swift` | One full-screen web view. Hands the page its saved items, keeps its copy of them, answers presses with haptics, tells the page the window and the fold. |
| `ios/Vesper9/Fold.swift` | Reads iPhone Duo's crease and hinge (Boxset's `DuoFold.swift`, cut down). |
| `ios/Vesper9/SaveStore.swift` | The app's copy of the saves: one JSON file in Application Support. |
| `ios/console-saves.py` | Makes the file that brings the console's own saves over. |
| `ios/project.yml` | The Xcode project, generated with XcodeGen. Bundle `com.samuelairs.vesper9`, name VESPER-9, iOS 17 and later. |

Nothing in `web/`, `vesper/` or `firmware/` is changed. The app needs no network and asks for
no permission.

## iPhone Duo

The app reads the crease (iOS 27.1's reserved regions) and the hinge, and tells the page how the
phone is held, where the crease's band is, and the window's safe areas. Sam's Duo: the inner
display is 951 × 669 points, the crease a 40-point band at its middle, the status bar a row of
82 at the top when turned upright and a column of 84 at the right when opened like a book.

| How it is held | What the page does |
| --- | --- |
| **Part folded, the lower half on the table** (laptop) | The upper half is the screen and the lower half is the node. In a game the picture alone fills the upper half, from the status row to the crease (664 × 374 on Sam's Duo); lamps, title, MENU, the game's numbers and text, and the button are below. The dashboard has its masthead and the sector's title above, the sectors and cards (three across) below. An instrument has its display above and its buttons below. The menu has its name above and its choices (two across, all showing) below. Nothing read or touched is in the crease's band. The screen stays on. |
| **Opened flat and turned upright** | The same layouts as the laptop. |
| **Opened like a book** (flat or part folded) | One window, as on an iPad: the page's own full-screen play mode across the crease (867 × 488), clear of the status column. |
| **Closed** (the outer display) | An ordinary phone: upright, the game the full width (466 × 262) with the button below; sideways, the page's play mode. |

A fold that lands on a new posture gives a soft click, as Sam's other Duo apps do. The page is
loaded only once the fold has been read, so its first picture is already laid out for it.

## Other phones and iPad

- **Edge to edge.** The case's frame is the phone. The page keeps clear of the status area,
  the corners and the home bar.
- **Sideways:** the page's own play mode (`style.css`, from 700 × 400 up). A phone held
  sideways is a few points short of that, so the page is laid out at the smallest size that has
  play mode and shown slightly smaller (852 × 393 becomes 868 × 400).
- **Upright:** lamps, title and MENU on top, the game under them at full width, then its
  numbers and its line of text, and the button below: the whole lower area presses it.

The dashboard is used by touch: tap a card, a sector or a menu line. The on-screen button and
tapping the game are the one button everywhere else.

## Saves

The console keeps scores, progress, settings and timers in the web view's storage (one item,
`vesper-demo`). The app keeps a copy of every item in its own file. The web view's copy is the
one in use; the app's copy only fills in what the web view no longer has, so an older copy never
replaces newer progress.

### Bringing the console's saves over

The Pi's service keeps the same two maps (best scores, each game's progress) in
`vesper.sqlite3`. To carry them to the phone:

```powershell
python ios/console-saves.py <the console's vesper.sqlite3> console-saves.json
```

Then on the phone: Files › On My iPhone › VESPER-9, put `console-saves.json` there, and open
VESPER-9. Each best score becomes the higher of the two; each game in the file replaces the
phone's progress for that game; the phone's settings and timers stay. The file is taken in once
and renamed `console-saves (brought over).json`. The file is a person's own progress: it never
goes in git.

The console's newest saves are on the Pi in
`~/VESPER-9-v0.2.0-Claude/releases/0c1bf13…/trial-data/vesper.sqlite3` (25 best scores, 32
games' progress, last played 2026-10-03).

## Not in the app yet

- **Case taps.** The console hears a knock on its case; the app has no second input, so a game's
  optional case action and "CASE: PREVIOUS" do nothing. No game needs one to be finished.
- **Speech.** Voice commands and dictation run on the Pi (Vosk). The microphone button is hidden;
  the menu's MICROPHONE line still answers that speech needs the Pi.
- **Books and the encyclopedia.** The Stacks shows only its guide; the books come from the Pi's
  service. The repository's `books/` has fifteen that could ride in the app.
- **Timers in the background.** A timer that ends while the app is closed says nothing until the
  app is opened.
- **Sound follows the phone's silent switch**, as web-view sound does by default.
- Node Scope and Telemetry show the simulated node, as in the browser simulator.

## Building

`.github/workflows/ios.yml` runs on a push that changes `ios/` or the workflow: it builds the
page, generates the project, compiles for the simulator, and takes pictures there: three on a
phone (the dashboard, Orbit Lock, High Bar), then the Duo's postures. The simulator cannot fold,
so those ask the app for a pretend fold (`-VesperFold across|down`, `-VesperHinge half`), which
also makes its window the Duo's size; they are taken on an iPad, whose screen is large enough to
hold it. The pictures and the build log are the run's artifact. This repository is public, so
GitHub's Mac minutes cost nothing.

TestFlight (a commit message with `[testflight]`, or the box on a manual run) needs, once:

1. The bundle ID `com.samuelairs.vesper9` and an app record in App Store Connect.
2. The four signing secrets on this repository: `APPLE_TEAM_ID`, `APP_STORE_CONNECT_KEY_ID`,
   `APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_KEY`.

Until then a `[testflight]` build compiles and says the secrets are not set.

For the App Store itself, later: a privacy manifest, the listing, and a decision on the apps
that need the Pi.

## Checks on the PC

```powershell
python -m unittest tests.test_ios_page
python scripts/check-browser.py --only ios-page-browser
```

The first builds the page, checks that the layer still names things the page has and that Swift
and `app.js` use the same words, and reads a console database with `console-saves.py`. The
second needs Playwright and Chrome (`docs/TESTING.md`); it stands in for the app with a recorder
for the page's messages and calls `vesperApp.fold()` with the Duo's numbers. Neither runs Swift
or WebKit.

## The icon

`ios/icon.svg` is the console's own mark on its screen colour. The PNG in the asset catalog is
that file drawn at 1024 × 1024 and saved without transparency, which App Store Connect requires.
