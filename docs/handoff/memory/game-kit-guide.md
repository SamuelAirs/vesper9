---
name: game-kit-guide
description: Self-contained guide for outside chatbots to build Vesper games, and the folder format games come back in (2026-10-02)
metadata:
  type: project
  modified: 2026-10-02T04:39:50.906Z
---

2026-10-02 Sam asked for a framework description so another chatbot can build several games overnight; he'll send them back for integration in the morning.

- Guide: /mnt/project-files/game-kit/GAME-KIT.md (self-contained; embeds the reference game BEACON). Reference files in /mnt/project-files/game-kit/beacon/.
- Each game returns as a folder `<id>/` with `web/apps/<id>.js`, `tests/<id>.test.mjs`, `catalog-entry.json` (plus a suggested `sector` key to strip), NOTES.md. Nothing outside it.
- Integration steps (ours): register factory in web/apps/registry.js, add entry to vesper/catalog.json and a sector (max 6 per sector), add id to the GAMES list in tests/gesture-apps.test.mjs, rebuild catalog/demo, run all suites, frame-check.
- Guide tells authors: AppGuard + LampBus, save keys schema/runs/milestone/last, latencyMs, no own daily/feats/hidden menus, no per-frame gradients, one name per `export const` (build-demo.py bundler only exports the first name).

Pi 3B+ answer given: likely runs the lighter games at reduced quality; heavy visual drafts would be 20–30 fps; 1 GB RAM tight with speech. Based on desktop CPU-throttle measurements, not a real 3B+.

Related: [[sensor-input-direction]]
