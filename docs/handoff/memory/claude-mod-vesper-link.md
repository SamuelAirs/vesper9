---
name: claude-mod-vesper-link
description: vesper-link Claude Code mod (Vesper look + node lamps + push-to-talk) delivered as a zip in /mnt/project-files/claude-mod/, not in the repo
metadata:
  type: project
  modified: 2026-10-02T04:00:48.241Z
---

2026-10-02: thread "Claude Code mod for the node" built `vesper-link`, a Claude Code mod (function hooks, Claude Code 2.1.287+) plus a Python bridge, delivered as /mnt/project-files/claude-mod/vesper-claude-link.zip with INSTALL-PROMPT.md for an agent on the Pi or desktop. Not committed to the vesper9 repo.

- Bridge owns the node's serial port (protocol v1, firmware unchanged), prints JSON lines to the mod, takes lamp modes over loopback HTTP 127.0.0.1:47219 with a per-session token. Installs to ~/.local/share/vesper-claude-link (venv + config.json); mod to ~/.claude/mods/vesper-link via CLAUDE_CODE_PLUGIN_DIRS.
- Push-to-talk uses the node's real 16 kHz PCM (the mic is not loudness-only) with Vosk, plus the console's Parakeet pass if installed. Mic on only while the button is held.
- On the Pi it never fights vesper.service: `/vesper takeover` stops it, `/vesper release` or session end restarts it.
- Verified off-device only (fake node on a pty, plugin tests, headless session). Not yet run on the real node.

**Why:** Sam asked for Claude Code to switch into a Vesper-9 look when the node is plugged in.
**How to apply:** follow-ups on the mod go to that thread; device testing goes through a session on the Pi. Related: [[MEMORY]]
