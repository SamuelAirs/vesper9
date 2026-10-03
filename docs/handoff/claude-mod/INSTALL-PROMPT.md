# Prompt: install and test the VESPER-9 Claude link

Paste everything below the line into Claude Code on the machine the node is plugged into (the
Raspberry Pi cyberdeck or the desktop), started in the folder where this zip was unpacked.

---

You are installing **vesper-link**, a Claude Code mod plus a small Python bridge, from this
folder. Read `README.md` first. When the VESPER-9 node is plugged in, the mod gives Claude Code
the VESPER-9 console look, drives the node's three lamps from what Claude is doing, and makes the
node's button push-to-talk. It does not use the Vesper console software. Work through the steps
in order, and stop and tell me if a step fails in a way you cannot fix inside this folder or the
install folders named below.

Ground rules:
- Do not flash or change the node's firmware. The mod works with the installed firmware
  (protocol v1).
- Do not edit the VESPER-9 console checkout, its data, or its service file. Only read its
  `models/` folder.
- Before anything stops the Vesper console service (step 6), ask me. I may be using it.
- Report honestly what you saw on the device and what you could not check.

1. **Claude Code version.** Run `claude --version`. The mod needs function-hook mods, which
   2.1.287 has. If it is older, update Claude Code first (`claude update`, or however it was
   installed here) and check again.

2. **Install.** Find out where we are:
   - On the Raspberry Pi: find the VESPER-9 console checkout (the folder with `vesper/server.py`
     and `models/`, probably named like `VESPER-9-…`). Run
     `bash install.sh --vesper-dir <that folder>`. The bridge then reuses the console's Vosk and
     Parakeet models.
   - On a Linux or macOS desktop: `bash install.sh`. It downloads Vosk's small English model
     (about 40 MB).
   - On Windows: install.sh does not run. Do the same by hand: a venv in
     `%LOCALAPPDATA%\vesper-claude-link\venv`, `pip install "<this folder>\bridge[speech]"`, the
     model `vosk-model-small-en-us-0.15` unzipped under `%LOCALAPPDATA%\vesper-claude-link\models`,
     a `config.json` beside the venv (see the one install.sh writes for its keys), copy
     `mod\vesper-link` to `%USERPROFILE%\.claude\mods\vesper-link`, add that folder to `env`
     `CLAUDE_CODE_PLUGIN_DIRS` in `%USERPROFILE%\.claude\settings.json`, and set the mod's
     `bridgeCommand` option (in `/config`, or `pluginConfigs` in settings.json) to the venv's
     `Scripts\vesper-link.exe`.

   Show me the `config.json` it wrote. On Linux, if it says the user is not in `dialout`, tell me
   the command and wait for me to run it.

3. **Off-device checks.** Run and report:
   - `cd bridge && ~/.local/share/vesper-claude-link/venv/bin/python -m unittest -v test_vesper_link`
   - `claude plugin validate ~/.claude/mods/vesper-link`
   - `claude plugin test ~/.claude/mods/vesper-link`

4. **Find the node.** With the node plugged in, list the serial ports
   (`ls -l /dev/serial/by-id/` on Linux). The bridge looks for the CH343 COM bridge
   (`1a86:55d3`, on the Pi `/dev/serial/by-id/usb-1a86_USB_Single_Serial_…-if00`) and the
   ESP32-S3 native port (`303a:1001`), preferring the CH343. If neither shows, set `serial_port`
   in `config.json` to the right device.

5. **Bridge alone.** Without Claude in the loop, check the bridge talks to the node:
   `VESPER_LINK_TOKEN=test ~/.local/share/vesper-claude-link/venv/bin/vesper-link --standalone` (in a second
   terminal or as a background job; stop it with Ctrl-C). Expect JSON lines: `hello`,
   `speech ready`, then `node connected` with the firmware version. On the Pi, if the console
   service is running you will see `held` instead: go to step 6 first, then come back. While it
   runs, try from another terminal:
   `curl -s -X POST -H 'X-Link-Token: test' -d '{"mode":"working"}' http://127.0.0.1:47219/mode`
   and the same with `waiting` and `attention`, and tell me what the lamps do. Hold the button,
   say a sentence, let go: a `ptt done` line with your words should appear. Stopping the bridge
   must leave the lamps off.

6. **Pi only: sharing the node with the console.** The console service (`vesper.service`, a
   systemd user unit) holds the node's port. Ask me before stopping it. Once I agree, the mod
   does it itself: in Claude Code, `/vesper takeover` stops the service, and `/vesper release` or
   ending the session starts it again. Check that the console comes back after a release.

7. **In Claude Code.** Start `claude` in any folder.
   - Without the node (or before plugging it in): `/vesper simulate` should bring up the VESPER-9
     band above the prompt; `/vesper say what time is it` should send that as a prompt;
     `/vesper simulate off` returns to the normal look.
   - With the node: plugging it in should show a toast and the band within a few seconds. Ask
     Claude something that uses a tool (for example, to list the files here) and watch the lamps
     move from the green sweep (working) with cyan ticks (tools) to the amber breath (waiting).
     Trigger a permission prompt and check for the amber and red alternation. Hold the button,
     speak, release: the words should appear in the band while you talk and then go out as your
     reply. Tap twice during a long answer to stop it. Unplug the node: the normal look returns.
   - `/vesper` opens the console pane.
   - If something misbehaves, run `claude --debug` and look for lines starting `vesper-link`.

8. **Report back** in a short list: what passed, what failed, what you could not check, the
   Claude Code version, the port used, the speech engine the bridge reported, and how long a
   short sentence took from release to the text appearing. Note anything about the lamps that
   looks wrong, including brightness (`/vesper lamps 0-100` adjusts it).
