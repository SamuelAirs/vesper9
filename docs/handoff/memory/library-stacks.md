---
name: library-stacks
description: The Stacks book library app (PR #12) — what it supports, Kindle limits, and where books live
metadata:
  type: project
  modified: 2026-10-01T23:36:47.575Z
---

Library app "THE STACKS" (`library`, PR #12, thread "library", opened 2026-10-01) is owned by the library thread.
- Reads DRM-free EPUB, plain text, and a Kindle e-reader's My Clippings.txt (highlights). Books live in `data/console/library` on the Pi.
- Kindle purchases can't be read: they are DRM-protected, Amazon dropped Download & Transfer via USB in Feb 2025, and we never strip DRM (decision made in this thread, told to Sam).
- Books come in through the service: USB import from `/media`, or a fixed Project Gutenberg list (needs the Pi online).
- Catalog: put in INSTRUMENTS II on main. When PR #11's sectors land, it should move to MIND (the dashboard thread decides). See [[dashboard-sectors]].
