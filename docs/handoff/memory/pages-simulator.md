---
name: pages-simulator
description: Public web copy of the standalone simulator at samuelairs.github.io/vesper9, published from main by GitHub Pages
metadata:
  type: project
  modified: 2026-10-02T03:24:53.813Z
---

Since 2026-10-02 the repo is public, and `.github/workflows/pages.yml` (PR #13) rebuilds `VESPER-9-Simulator.html` on every push to main and publishes it at https://samuelairs.github.io/vesper9/. This is how Sam plays on the iPad, iPhone and Steam Deck. It's the simulator only: no Pi, no node, and saves stay in each browser.

**Why:** Sam wanted to play on other devices. Sam chose to make the repo public as is after a scan found no secrets, only small personal details: commit email, LAN IP in docs/WORKLOG.md, node MAC and serial.

**How to apply:** everything merged to main ships to the public page within minutes, so never commit secrets, Wi-Fi details or Sam's data. The Pi's own service is still loopback-only, so there's no LAN play. Gamepad support was offered but not built. Related: [[MEMORY]]
