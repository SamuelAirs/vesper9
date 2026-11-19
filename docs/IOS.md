# VESPER-9 on iPhone

A native app for iPhone, iPhone Duo and iPad that carries the console's own page: the same
engine, games and instruments as the browser simulator, with the node drawn on screen. It is
built first for iPhone Duo.

## Where it stands (2026-11-19)

- **Written and checked on the PC:** the page the app shows, in Chrome at iPhone, iPhone Duo and
  iPad sizes, with the Duo's fold given as the app gives it: seven browser checks, 1,964 checks in
  all, eight Python tests, and the engine's own JavaScript tests (1,666). Twelve of the engine's
  Python test files need the service's `aiohttp`, which this PC does not have; GitHub's
  Regressions workflow runs them on a push (see "Checks on the PC").
- **Compiled, and run on simulators** (2026-11-19, GitHub's Mac, Xcode 27, three runs): the
  Swift shell (`ios/Vesper9/`) compiled at the first attempt without a warning, and the app ran
  in WebKit. Run 1, the iPhone Duo's simulator (iOS 27.2), closed: the page, its type (Menlo),
  the plain-phone layouts, the handheld edition, the case plates and the text floor. Run 2, the
  Duo's postures with a pretend fold on an iPad: the laptop (dashboard, Orbit Lock, Cadence),
  opened and turned upright (High Bar), the book (dashboard, Orbit Lock), and a plain iPad. They
  are laid out as in Chrome: the game's picture alone in the upper half, nothing in the crease's
  band, everything touched below it.
  Run 3, the closed Duo again: the clock is in its status column, The Stacks opens its books
  with no network, and a game no longer has the timers' line on its button.
- **Not done at all:** nothing has run on a phone. Haptics, sound, the real fold, and saved
  progress across launches are untried.
- **A review of every game and instrument on the phone** (2026-11-19) is in Sam's notes:
  `Vesper 9/Critique 2026-11-19.md`. Its larger findings (small text in the games, apps and words
  that are only true of the console) were answered the same day, in the engine and the layer.

## What the app is

| Part | What it does |
| --- | --- |
| `ios/build-web.py` | Builds the page: the standalone console (`scripts/build-demo.py`) with the app's layer added to its head, then whatever `ios/extras/*.py` write beside it. Output in `ios/Web/` (not in git). |
| `ios/layer/*.css` | The app's layouts and look, all under `html.vesper-app`, added in the order of their names: `10-base` (edge to edge, the type), `20-play` (games), `25-phone` (every other screen on a plain phone), `30-fold` (the Duo's crease across), `50-case` (the case plates), `70-lamps` (the lamps' light). The console on the Pi and the browser simulator never load them. |
| `ios/layer/*.js` | Added the same way: `10-core` (what the parts share), `20-saves`, `30-fit` (the viewport and the fold), `40-button`, `45-timers` (the timers' line in a game), `50-case`, `15-edition` (the handheld edition), `60-library` (The Stacks' books), `70-lamps`, `80-text` (the games' text floor), `90-ready`. |
| `web/apps/edition.js`, `web/engine/draw.js` | The engine's two additions, which do nothing unless asked: an edition (what to hide, which words to use) and a floor under the games' text. |
| `ios/extras/books.py` | Writes The Stacks' fifteen books into `Web/books/` (47 scripts, 7.4 MB). |
| `ios/Vesper9/Console.swift` | One full-screen web view. Hands the page its saved items, keeps its copy of them, answers the button and the case with haptics, tells the page the window and the fold. |
| `ios/Vesper9/Fold.swift` | Reads iPhone Duo's crease and hinge (Boxset's `DuoFold.swift`, cut down). |
| `ios/Vesper9/SaveStore.swift` | The app's copy of the saves: one JSON file in Application Support. |
| `ios/console-saves.py` | Makes the file that brings the console's own saves over. |
| `ios/project.yml` | The Xcode project, generated with XcodeGen. Bundle `com.samuelairs.vesper9`, name VESPER-9, iOS 17 and later. |
| `tests/helpers/ios-page.cjs` | Shared by the page's browser checks: builds the page, opens it with a stand-in for the app, and holds the cases (the Duo's postures, phones, an iPad). |

The engine in `web/` has two additions the app turns on (below); with neither asked for, the
Pi console and the browser simulator read, behave and draw as before. `firmware/` is unchanged.
The app needs no network and asks for no permission.

## iPhone Duo

The app reads the crease (iOS 27.1's reserved regions) and the hinge, and tells the page how the
phone is held, where the crease's band is, and the window's safe areas. Sam's Duo: the inner
display is 951 × 669 points, the crease a 40-point band at its middle, the status bar a row of
82 at the top when turned upright and a column of 84 at the right when opened like a book.

| How it is held | What the page does |
| --- | --- |
| **Part folded, the lower half on the table** (laptop) | The upper half is the screen and the lower half is the node. In a game the picture alone fills the upper half, from the status row to the crease (664 × 374 on Sam's Duo); lamps, title, MENU, the game's numbers and text, the button and the case plates are below. The dashboard has its masthead and the sector's title above, the sectors and cards (three across) below. An instrument has its lamps, title and its whole display above and its buttons below. The menu has its name above and its choices (two across, all showing) below. Nothing read or touched is in the crease's band. The screen stays on. |
| **Opened flat and turned upright** | The same layouts as the laptop. |
| **Opened like a book** (flat or part folded) | One window, as on an iPad: the page's own full-screen play mode across the crease (867 × 488), clear of the status column. |
| **Closed** (the outer display) | An ordinary phone (below), 382 points wide: the status column is at the right of the outer display too (84 of its 466 points; seen on the simulator, and measured on Sam's Duo by FoldForm). |

The status bar is hidden on every other phone, as in a game. A folding phone keeps its status
column or row clear whether or not anything is shown in it, so there the clock and the battery
are shown (`Fold.folding`: a hinge, a crease, or side safe areas that differ). Seen on the Duo's
simulator, closed (the third build); not on a phone.

A fold that lands on a new posture gives a soft click, as Sam's other Duo apps do. The page is
loaded only once the fold has been read, so its first picture is already laid out for it.

## Other phones and iPad

- **Edge to edge.** The case's frame is the phone. The page keeps clear of the status area,
  the corners and the home bar.
- **A game, sideways:** the page's own play mode (`style.css`, from 700 × 400 up). A phone held
  sideways is a few points short of that, so the page is laid out at the smallest size that has
  play mode and shown slightly smaller (852 × 393 becomes 868 × 400).
- **A game, upright:** lamps, title and MENU on top, the game under them at full width, then its
  numbers and its line of text, and the button below with the case plates at its sides.
- **Everything else on a plain phone** (`25-phone.css`): one screen each. Upright: a slim
  masthead, the sector's title, the sectors on one line, the cards two across in their own
  scrolling row, and the button's deck fixed above the home bar; an instrument and the menu the
  same way. Sideways: two columns. An iPad keeps the page's own rules.

The dashboard is used by touch: tap a card, a sector or a menu line. The on-screen button and
tapping the game are the one button everywhere else.

## The case, on screen

The console hears a knock on its case; the engine calls it a case tap (previous in a menu, twice
for back, an optional action in a game, left and right in Twinbeat). A tap on the back of the
phone is an iOS accessibility feature and is not used. Instead (`50-case`):

- **In a game:** two case plates. Upright and with the Duo's crease across, at the outer ends of
  the button's row (22 % of the width each; the cap stays in the middle). Sideways, in the
  picture's margins. With the Duo opened like a book, in the band under the picture. The left
  one knocks left and the right one right; in the default mode both are a plain knock.
- **Not in a game:** a CASE key beside the button in the deck, and in the menu's own row.

The button and a plate can be held together.

## The lamps

The node's four lamps are drawn larger where there is room, and their light falls on the panel
around them in each lamp's own colour (`70-lamps`): in pools on the deck, one under each lamp's
quarter of the width, and along the top row's edge sideways. It only follows the lamps: the same
values the page paints them with, on the same events, with no animation of its own.

## The handheld edition

The console is told its edition before it starts (`window.VESPER_EDITION`, set by
`15-edition.js`, read only by `web/apps/edition.js`). On a handheld:

- **Not shown:** Field Notes, Resonance, Atmosphere, Node Scope, Telemetry, the Encyclopedia,
  the menu's MICROPHONE line, and SYSTEM TOOLS (Calibration, all it would hold, has its own
  line). They are on no sector's page and never a pick of the day; the LISTEN sector, left
  empty, is gone. Five more are in the catalog and on no sector (Tideline, Descent, Chronometer,
  Ephemeris, Atmosphere): retired, and they stay so.
- **Said truly:** where the console's words are untrue of a phone (the space bar, the Pi's
  clock, the node, the book service), the handheld has its own; an app can carry `"handheld"`
  words in `vesper/catalog.json`.
- **Calibration:** CASE PLATES (GENERIC or LEFT / RIGHT) stands in for the two settings that
  needed the node, so Twinbeat's two-side play can be switched on.
- **Twinbeat** judges a plate like the button, at the touch. **Light Trial** is called TOUCH,
  says its time includes the display and the touch, and keeps its best apart from the node's.

## Readable text

Most games draw their smaller text at 10 to 18 pixels of the 960-wide picture, which is 4 to 7
points on an upright phone. The engine can be given a floor: `draw.js` `text()` never draws
smaller than it, and the host sets it around each app's draw from the size the picture is shown
at. The app asks for 9 points (`80-text.js`), for the games that have been looked at with it:
High Bar, Cairn, Twinbeat, Orbit Lock, Moonrunner, Outpost, Perihelion, Wayfinder, Ballista,
Glyph Archive, Pocket Links, Night Grid, Undertow, Echo Vault, Relay, Meridian, Ricochet and
Signal School. Their layouts follow the drawn size where it would have overflowed. Crawlspace,
Supper Club and Light Trial are not on the list and draw as before.

## Type

The games ask for DejaVu Sans Mono by name. An iPhone has no such face and would fall back to
Courier New. `10-base.css` gives that name, and the page's VesperMono, to Menlo, which every
iPhone has and which is cut from the same design with the same widths. Untried on a phone.

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

## Books

The Stacks reads the fifteen books in `books/` (Standard Ebooks, public domain). The Pi's
service answers for the shelf and one chapter at a time; `ios/extras/books.py` writes those same
answers, made with the service's own code, as scripts beside the page, and `60-library.js` adds
a script when a part is first wanted (a page opened from a file cannot fetch). Places and
bookmarks are kept with the other saves. Fetching more classics and importing from a USB drive
say that the app reads only the books built into it.

## Not in the app yet

- **Crawlspace and Supper Club at phone size:** their cards overflow with floored text, so they
  keep their small text until each has its own layout.
- **Lists drawn in a game** (Wayfinder's routes, High Bar's setup) look tappable; a tap
  anywhere is the button.
- **Speech.** Voice commands and dictation run on the Pi (Vosk). The microphone button is hidden.
- **Timers in the background.** A timer that ends while the app is closed says nothing until the
  app is opened.
- **Sound follows the phone's silent switch**, as web-view sound does by default.
- In sideways play the bottom row of hints lies in the home bar's strip (the bar itself hides).

## Building

`.github/workflows/ios.yml` runs on a push that changes `ios/` or the workflow: it builds the
page, generates the project, compiles for the simulator, and takes pictures there: five on a
phone (the dashboard, Orbit Lock, High Bar, Cadence, The Stacks), then the Duo's postures. The
Duo's simulator starts folded shut and nothing opens it, so the phone's pictures are of its
outer display, the closed phone as it is. For the postures the app is asked for a pretend fold
(`-VesperFold across|down`, `-VesperHinge half`), which also makes its window the Duo's size;
they are taken on an iPad, whose screen is large enough to hold it. The pictures never fail a
build: every `simctl` call has a limit, each of the two steps stops before its time is up, and
its log has the time of each stage (a new simulator can take three minutes to start and up to
five to install the app). The pretend book goes without the status bar: the iPad's is a row
along the top, where the Duo's is the column at the right. The pictures and the build log are the run's artifact. This repository is
public, so GitHub's Mac minutes cost nothing.

TestFlight (a commit message with `[testflight]`, or the box on a manual run) needs, once:

1. The bundle ID `com.samuelairs.vesper9` and an app record in App Store Connect.
2. The four signing secrets on this repository: `APPLE_TEAM_ID`, `APP_STORE_CONNECT_KEY_ID`,
   `APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_KEY`.

Until then a `[testflight]` build compiles and says the secrets are not set.

For the App Store itself, later: a privacy manifest, the listing, and a decision on the apps
that need the Pi.

## Checks on the PC

```powershell
python -m unittest tests.test_ios_page tests.test_ios_books
python scripts/check-browser.py --only ios-page-browser
python scripts/check-browser.py --only ios-case-browser
python scripts/check-browser.py --only ios-phone-browser
python scripts/check-browser.py --only ios-lamps-browser
python scripts/check-browser.py --only ios-library-browser
python scripts/check-browser.py --only ios-edition-browser
python scripts/check-browser.py --only ios-text-browser-1of3   # then 2of3, 3of3, and -pixels
python scripts/check.py                                         # the engine's own suite
```

| Check | What it covers | Checks |
| --- | --- | --- |
| `test_ios_page` | The page is built right; the layer names only what the page has; Swift and the layer use the same words; a console database is read as the service gives it. | 4 tests |
| `test_ios_books` | The books build writes the same bytes twice; every book is on the shelf; chapters equal the service's. | 4 tests |
| `ios-page-browser` | The play layouts, the Duo's crease in every screen, folding mid-game, the button's messages, the timers' line, the saves. | 135 |
| `ios-case-browser` | The case plates and keys in every case, held with the button, turning mid-game. | 167 |
| `ios-phone-browser` | Every screen one screen on a plain phone; nothing else moved. | 553 |
| `ios-lamps-browser` | The light follows the lamps, moves nothing and takes no touch. | 527 |
| `ios-library-browser` | The shelf, a first page, paging, the saved place, no network. | 54 |
| `ios-edition-browser` | Nothing hidden can be reached; each reworded line; Twinbeat's timing; the standalone page unchanged. | 114 |
| `ios-text-browser` | In three parts: no text under the floor, none off the picture, no new overlap; with the floor off, every frame's text as before. `--pixels`: the plain simulator pixel for pixel. | 414 + 15 |
| `edition.test.mjs`, `draw-floor.test.mjs` | The edition and the floor in node. | 8 + 6 tests |

The browser checks need Playwright and Chrome (`docs/TESTING.md`). They stand in for the app
with a recorder for the page's messages and call `vesperApp.fold()` with the Duo's numbers. None
of them runs Swift or WebKit.

## The icon

`ios/icon.svg` is the console's own mark on its screen colour. The PNG in the asset catalog is
that file drawn at 1024 × 1024 and saved without transparency, which App Store Connect requires.
