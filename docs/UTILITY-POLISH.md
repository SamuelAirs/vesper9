# Utility journey polish — 2026-10-03

This pass fixes bounded usability defects in the existing Stacks, Encyclopedia,
Lantern and Cadence tools. It preserves existing saved books, bookmarks, article
trails and timer ownership. Reader layouts and private book/archive files remain
unchanged.

## Changes

- Stacks leaves a failed chapter request settled until a deliberate page tap
  retries it. The previous update/draw path could request the same unavailable
  chapter on every frame despite displaying a retry instruction.
- Encyclopedia stores each recently read article's paragraph/character position.
  Revisiting an article after reading another one resumes that article's place.
  Older version-1 records still load, including their current last-article place.
- An article without links has a clear completion screen: tap stays on its last
  page; hold returns home. Automatic turning stops at that screen.
- Encyclopedia removes category blocks and the archive footer from article
  paragraphs and extracted links. This was verified against a real short article
  whose text was previously buried among hidden categories and Kiwix furniture.
  The archive attribution on Encyclopedia home remains available.
- Lantern uses the host's lifetime-guarded action focus callback so lamp previews
  match button advance, generic case reverse, arrows and clicks. Selection does
  not advance twice when both the host and app receive the same release. The
  palette label now applies to any supported lamp count.
- Cadence's large selected timer shows its actual number in the service timer
  list. NEXT updates both the selected timer and its number.

## Verification

Focused JS suites: **84/84 passed** across Library, Encyclopedia, Lantern and
Cadence. The existing timer-tool suite additionally passed **25/25** after its
stale always-1-of-N expectation was replaced with explicit selected-timer and
NEXT-number assertions. Python Library passed **13/13** and Encyclopedia
**8/8**, including category/footer extraction coverage.

`tests/utility-polish.cjs` passed **25/25** actual browser checks at 1024×600:
existing Stacks place/bookmark and reload, next/previous controls, one injected
503 and intentional retry/recovery, real Encyclopedia content/link/trail/recent
place/bookmark/reload, a random article, missing-archive guide/exit, Lantern
preview/selection/sleep/off, and two concurrent Cadence timers with selected
pause/add-a-minute behavior. Reloads wait for the host save queue to drain.

The real read-only source was
`wikipedia_en-simple_all_nopic_2026-09.zim`: **400,061 articles**, **1,094,936,257
bytes**. A private temporary data directory contained the test book, database
and a link/copy of the archive. One tab controlled an owned loopback simulator;
the test cleanup stopped only that service process tree and removed only its
temporary data. Port 8799 and production data were not used. The microphone
stayed off and browser/host faults were absent.

Ten screenshots were inspected: existing Stacks place and loading error; Sun,
Star, cleaned short article, random article and missing-archive guide; Lantern
colour and sleep; and Cadence's two timers. They fit the 1024×600 console and
show legible content and control hints.

Evidence is under
`C:\Users\ayers\vesper9-investigation\polish\utilities-browser\` with the
result file `utility-polish.json`. Focused logs and the fuller assessment are in
the parent `polish` directory (`utilities-report.md`).

This is Windows browser/service evidence with synthetic controls. It does not
qualify the actual Pi display, physical button, acoustic case taps, lamps,
speech recognition, USB insertion or Pi performance. Import/download backends
were covered by focused fixture tests; no network book purchase/download or
physical USB import was attempted in the browser journey.
