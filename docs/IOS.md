# VESPER-9 on iPhone

A native app for iPhone, iPhone Duo and iPad that carries the console's own page: the same
engine, games and instruments as the browser simulator, with the node drawn on screen.

## Where it stands (2026-11-18)

- **Written and checked on the PC:** the page the app shows and its phone layouts, in Chrome at
  iPhone, iPhone Duo and iPad sizes (`tests/ios-page-browser.cjs`, 75 checks, pictures in the
  test output).
- **Written, never compiled:** the Swift shell (`ios/Vesper9/`), the project (`ios/project.yml`)
  and the build workflow (`.github/workflows/ios.yml`). No Mac has seen them. The first push of
  this branch to GitHub is their first compile.
- **Not done at all:** nothing has run in WebKit, in a simulator or on a phone. Haptics, sound,
  the real safe-area insets, the Duo's fold and saved progress across launches are untried.

## What the app is

| Part | What it does |
| --- | --- |
| `ios/build-web.py` | Builds the page: the standalone console (`scripts/build-demo.py`) with the app's layer added to its head. Writes `ios/Web/index.html` (not in git). |
| `ios/layer/app.css` | The phone layouts, all under `html.vesper-app`. The console on the Pi and the browser simulator never load it. |
| `ios/layer/app.js` | Keeps the saves, fits the viewport, tells the app when the button moves. |
| `ios/Vesper9/Console.swift` | One full-screen web view. Hands the page its saved items, keeps its copy of them, answers presses with haptics, tells the page the view's size. |
| `ios/Vesper9/SaveStore.swift` | The app's copy of the saves: one JSON file in Application Support. |
| `ios/project.yml` | The Xcode project, generated with XcodeGen. Bundle `com.samuelairs.vesper9`, name VESPER-9, iOS 17 and later. |

Nothing in `web/`, `vesper/` or `firmware/` is changed. The app needs no network and asks for
no permission.

## The layouts

The page already has two: the scrolling console (dashboard, instruments, menus) and play mode,
where a game fills the screen (`style.css`, from 700 × 400 up). The app adds:

- **Edge to edge.** The case's frame is the phone. The page keeps clear of the status area,
  the corners and the home bar with the display's safe-area insets.
- **Sideways:** the page's own play mode. A phone held sideways is a few points short of
  700 × 400, so `app.js` has the page laid out at the smallest size that has play mode and shown
  slightly smaller (852 × 393 becomes 868 × 400).
- **Upright:** lamps, title and MENU on top, the game under them at full width, then its
  numbers and its line of text, and the button below: the whole lower area presses it.
- **Upright on a squarer screen** (iPhone Duo open, its outer display, an iPad): the game's row
  ends at the middle of the display, which on the Duo is the fold. The game is above it and
  everything touched is below it.

The dashboard is used by touch: tap a card, a sector or a menu line. The on-screen button and
tapping the game are the one button everywhere else.

## Saves

The console keeps scores, progress, settings and timers in the web view's storage (one item,
`vesper-demo`). The app keeps a copy of every item in its own file. The web view's copy is the
one in use; the app's copy only fills in what the web view no longer has, so an older copy never
replaces newer progress. These saves are the phone's own: they are not the Pi's.

## Not in the app yet

- **Case taps.** The console hears a knock on its case; the app has no second input, so a game's
  optional case action and "CASE: PREVIOUS" do nothing. No game needs one to be finished.
- **Speech.** Voice commands and dictation run on the Pi (Vosk). The microphone button is hidden;
  the menu's MICROPHONE line still answers that speech needs the Pi.
- **Books and the encyclopedia.** The Stacks shows only its guide; the books come from the Pi's
  service.
- **Timers in the background.** A timer that ends while the app is closed says nothing until the
  app is opened.
- **Sound follows the phone's silent switch**, as web-view sound does by default.
- Node Scope and Telemetry show the simulated node, as in the browser simulator.

## Building

`.github/workflows/ios.yml` runs on a push that changes `ios/` or the workflow: it builds the
page, generates the project, compiles for the simulator, and takes three pictures there (the
dashboard, Orbit Lock, High Bar), kept with the build log as the run's artifact. This repository
is public, so GitHub's Mac minutes cost nothing.

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

The first builds the page and checks that the layer still names things the page has. The second
needs Playwright and Chrome (`docs/TESTING.md`); it stands in for the app with a recorder for the
page's messages and sets the insets by hand. Neither runs Swift or WebKit.

## The icon

`ios/icon.svg` is the console's own mark on its screen colour. The PNG in the asset catalog is
that file drawn at 1024 × 1024 and saved without transparency, which App Store Connect requires.
