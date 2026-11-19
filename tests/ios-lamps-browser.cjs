// The lamps as light in the iPhone app's page (ios/layer/70-lamps.css and .js), in Chrome with a
// stand-in for the app, in the Duo's crease-across layout, an upright phone, the Duo closed, a
// phone sideways and the Duo opened like a book; on the dashboard and in a game. The lamps are set
// through the console's own bridge (off, lamp I red, all white, four colours) and lit by real apps
// (Lantern, Echo Vault). It checks that the light follows the values the page paints the lamps
// with, that nothing else moves or changes colour when the lamps light, that the light stays out
// of the game's picture and the crease, that it takes no touch, and that the page has no errors.
// Pictures of every state are saved for a person to judge. Not checked: WebKit, a phone's GPU and
// how bright it really looks on the display (docs/IOS.md).
const path = require("node:path");
const { CASES, sleep, build, launch, open: openPage, play, checker } = require("./helpers/ios-page.cjs");
const { output, html } = build("ios-lamps");
const { check, finish } = checker();

const NAMES = ["duo-laptop", "phone", "duo-closed", "phone-sideways", "duo-book"];
const zero = Array(12).fill(0);
const STATES = {
  off: zero,
  "red-i": [255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  white: Array(12).fill(255),
  four: [255, 70, 30, 230, 160, 30, 60, 210, 110, 60, 120, 255],
};

// In the page: what everything measures and its text colour (the lamps' own colour aside), and
// what the light is set to. Run synchronously around a lamp change, so no frame of the game
// comes between the two.
const HELPERS = `(() => {
  window.__snap = () => {
    const all = [...document.querySelectorAll("body *")];
    return {
      rects: all.map((e) => { const b = e.getBoundingClientRect(); return (e.id || e.className || e.tagName) + " " + [b.x, b.y, b.width, b.height].map((v) => v.toFixed(2)).join(","); }),
      colours: all.filter((e) => !e.closest(".lamp")).map((e) => (e.id || e.className || e.tagName) + " " + getComputedStyle(e).color),
    };
  };
  // Hue and brightness as 70-lamps.js derives them, from the colour the page painted a lamp.
  const derive = (rgb) => { const top = Math.max(...rgb); return top ? { hue: rgb.map((v) => Math.round(v * 255 / top)).join(" "), a: Math.round(top / 255 * 1000) / 1000 } : { hue: "0 0 0", a: 0 }; };
  window.__lamps = () => {
    const frame = document.getElementById("console"), lights = document.querySelector(".physical-lights");
    return ["0", "1", "2", "3", "b"].map((name, i) => {
      const lamp = document.getElementById(i < 4 ? "lamp-" + i : "lamp-board");
      const painted = lamp.hidden ? [0, 0, 0] : (lamp.style.backgroundColor.match(/\\d+/g) || []).slice(0, 3).map(Number);
      const lit = lamp.hidden ? false : lamp.style.background !== "" ;
      return {
        name, hidden: lamp.hidden, painted, want: lit ? derive(painted) : { hue: "0 0 0", a: 0 },
        hue: frame.style.getPropertyValue("--lamp-" + name).trim(), a: Number(frame.style.getPropertyValue("--lamp-" + name + "-a")),
        hue2: lights.style.getPropertyValue("--lamp-" + name).trim(), a2: Number(lights.style.getPropertyValue("--lamp-" + name + "-a")),
        own: lamp.style.getPropertyValue("--glow").trim(), ownA: Number(lamp.style.getPropertyValue("--glow-a")), dataLit: lamp.hasAttribute("data-lit"),
      };
    });
  };
  // Every colour with some light in a background image: [r, g, b, alpha].
  window.__light = (element, pseudo) => {
    if (!element) return null;
    const style = getComputedStyle(element, pseudo || null);
    const image = style.backgroundImage;
    const lit = [...image.matchAll(/rgba?\\((\\d+), (\\d+), (\\d+)(?:, ([\\d.]+))?\\)/g)].map((m) => [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]]).filter((c) => c[3] > 0);
    return { image: image !== "none", lit, pointer: style.pointerEvents, transition: style.transitionDuration, content: style.content };
  };
  // A pseudo-element's box on the page, from its host's and its resolved insets.
  window.__pseudoBox = (element) => {
    const s = getComputedStyle(element, "::before"), b = element.getBoundingClientRect();
    if (s.content === "none" || s.display === "none") return null;
    return { x: b.left + parseFloat(s.left), y: b.top + parseFloat(s.top), r: b.right - parseFloat(s.right), b: b.bottom - parseFloat(s.bottom) };
  };
})();`;

let browser;
(async () => {
  browser = await launch();
  const hues = (values) => [0, 1, 2, 3].map((i) => values.slice(i * 3, i * 3 + 3)).filter((rgb) => Math.max(...rgb) > 0)
    .map((rgb) => rgb.map((v) => Math.round(v * 255 / Math.max(...rgb))).join(","));

  for (const name of NAMES) {
    const one = CASES[name];
    const { context, page, errors } = await openPage(browser, html, one);
    await page.evaluate(HELPERS);
    const crease = one.told.crease, band = crease && crease[2] >= crease[3] ? [crease[1], crease[1] + crease[3]] : null;
    const sideways = one.w > one.h;

    // Nothing else takes the lamps while they are set by hand: the console's light director would
    // otherwise put its own values back within a frame.
    const hold = () => page.evaluate(() => vesper.lights.suspend(1e9));
    const set = (values) => page.evaluate((values) => {
      const before = (vesper.bridge.command("leds", { values: Array(12).fill(0) }), window.__snap());
      vesper.bridge.command("leds", { values });
      return { before, after: window.__snap() };
    }, values);

    for (const screen of ["dashboard", "game"]) {
      if (screen === "game") await play(page, "orbit");
      await hold();
      const playing = await page.evaluate(() => document.body.classList.contains("playing"));
      check(playing === (screen === "game"), `${name} ${screen}: ${playing ? "in play" : "on the dashboard"}`);
      for (const [state, values] of Object.entries(STATES)) {
        const { before, after } = await set(values);
        await sleep(80);
        await page.screenshot({ path: path.join(output, `${name}-${screen}-${state}.png`) });
        const moved = before.rects.filter((r, i) => r !== after.rects[i]);
        check(before.rects.length === after.rects.length && moved.length === 0, `${name} ${screen} ${state}: every element measures the same as with the lamps off ${moved.slice(0, 3)}`);
        const recoloured = before.colours.filter((c, i) => c !== after.colours[i]);
        check(recoloured.length === 0, `${name} ${screen} ${state}: every text colour is unchanged ${recoloured.slice(0, 3)}`);

        // The light agrees with the lamps as the page painted them, on every element that draws it.
        const lamps = await page.evaluate(() => window.__lamps());
        const wrong = lamps.filter((l) => l.hue !== l.want.hue || Math.abs(l.a - l.want.a) > 0.002 || l.hue2 !== l.hue || l.a2 !== l.a || l.own !== l.hue || l.ownA !== l.a || l.dataLit !== l.a > 0);
        check(wrong.length === 0, `${name} ${screen} ${state}: each lamp's light is the colour the page painted it ${JSON.stringify(wrong.slice(0, 2))}`);
        const expected = (values.length === 12 && !lamps[3].hidden ? values : values.slice(0, 9));
        const want = hues(expected);
        check(JSON.stringify(lamps.slice(0, 4).filter((l) => l.a > 0).map((l) => l.hue.split(" ").join(","))) === JSON.stringify(want), `${name} ${screen} ${state}: the light follows the values set (${want.join(" | ") || "none"})`);

        // Where the light is drawn in this layout, and that it is lit with the lamps' own hues.
        const drawn = await page.evaluate(({ playing, sideways }) => {
          const frame = document.getElementById("console");
          return {
            deck: playing ? (sideways ? null : window.__light(frame, "::before")) : window.__light(document.querySelector(".control-deck")),
            halo: playing ? window.__light(document.querySelector(".physical-lights"), "::before") : window.__light(document.querySelector(".instrument-bar")),
          };
        }, { playing, sideways });
        for (const [part, light] of Object.entries(drawn)) {
          if (!light) continue;
          const litHues = [...new Set(light.lit.map((c) => c.slice(0, 3).join(",")))].sort();
          const top = Math.max(0, ...light.lit.map((c) => c[3]));
          const pseudo = playing; // in play the light is a ::before of its own; else the page's own element's background
          check(light.image && (!pseudo || light.pointer === "none"), `${name} ${screen} ${state}: the ${part}'s light is drawn${pseudo ? " and takes no touch" : ""}`);
          check(JSON.stringify(litHues) === JSON.stringify([...new Set(want)].sort()), `${name} ${screen} ${state}: the ${part} is lit in exactly the lamps' hues (${litHues.join(" | ") || "dark"})`);
          check(top <= 0.62, `${name} ${screen} ${state}: the ${part}'s light is never glaring (strongest ${top})`);
          check(light.transition === "0s", `${name} ${screen} ${state}: the ${part}'s light has no animation of its own`);
        }
        if (state === "red-i") {
          // A lit lamp's rim takes its colour; an unlit one keeps the page's own.
          const rims = await page.evaluate(() => [0, 1].map((i) => getComputedStyle(document.getElementById("lamp-" + i)).borderTopColor));
          const scale = rims[0].startsWith("color(srgb") ? 255 : 1; // color-mix() serialises as color(srgb r g b), 0 to 1
          const red = (rims[0].match(/[\d.]+/g) || []).map((v) => Number(v) * scale);
          check(red[0] > 200 && red[1] < 60 && rims[1] === "rgb(98, 115, 90)", `${name} ${screen}: lamp I's rim is red, lamp II's the page's own (${rims.join(" / ")})`);
        }
        if (state === "red-i" && drawn.deck) {
          // Lamp I's pool is at the left of the deck.
          const at = await page.evaluate(({ playing }) => {
            const s = playing ? getComputedStyle(document.getElementById("console"), "::before") : getComputedStyle(document.querySelector(".control-deck"));
            const m = s.backgroundImage.match(/at (\d+(?:\.\d+)?)% 0(?:px|%), rgba\(255, 0, 0/);
            return m ? Number(m[1]) : null;
          }, { playing });
          check(at !== null && at < 25, `${name} ${screen}: lamp I's red falls on the left of the deck (${at}%)`);
        }
      }

      // The light's boxes: out of the game's picture and the crease.
      if (playing) {
        const boxes = await page.evaluate(() => {
          const stage = document.getElementById("game-stage").getBoundingClientRect();
          const frame = document.getElementById("console"), s = getComputedStyle(frame, "::before");
          return { stage: { y: stage.top, b: stage.bottom }, halo: window.__pseudoBox(document.querySelector(".physical-lights")), deck: s.content === "none" ? null : s.gridRowStart };
        });
        const h = boxes.halo;
        check(h && (h.b <= boxes.stage.y + 0.5 || h.y >= boxes.stage.b - 0.5), `${name}: the lamps' halo ends at the game's edge (${h && Math.round(h.y)} to ${h && Math.round(h.b)}, game ${Math.round(boxes.stage.y)} to ${Math.round(boxes.stage.b)})`);
        if (band) check(h.y >= band[1] - 0.5, `${name}: the halo starts below the crease (${h.y})`);
        check(sideways ? boxes.deck === null : boxes.deck === "3", `${name}: the deck's pools ${sideways ? "are not drawn sideways" : "start below the game's row"} (${boxes.deck})`);

        // In pictures: with the game's own drawing hidden, the game's area and the crease's band
        // are the same pixels with the lamps off and all white.
        const regions = await page.evaluate((band) => {
          // The picture inside the canvas (letterboxed sideways, where its margins hold the case plates).
          const c = document.getElementById("game").getBoundingClientRect(), k = Math.min(c.width / 960, c.height / 540);
          const out = [{ x: c.left + (c.width - 960 * k) / 2 + 1, y: c.top + (c.height - 540 * k) / 2 + 1, width: 960 * k - 2, height: 540 * k - 2 }];
          if (band) out.push({ x: 0, y: band[0], width: innerWidth, height: band[1] - band[0] });
          return out.map((r) => ({ x: Math.floor(r.x), y: Math.floor(r.y), width: Math.floor(r.width), height: Math.floor(r.height) }));
        }, band);
        await page.evaluate(() => { document.getElementById("game").style.visibility = "hidden"; });
        const shots = async (values) => {
          await page.evaluate((values) => vesper.bridge.command("leds", { values }), values);
          await sleep(60);
          return Promise.all(regions.map((clip) => page.screenshot({ clip })));
        };
        const dark = await shots(zero), lit = await shots(STATES.white);
        check(regions.every((r, i) => dark[i].equals(lit[i])), `${name}: no light in the game's area${band ? " or the crease" : ""} ${regions.map((r, i) => dark[i].equals(lit[i]))}`);
        await page.evaluate(() => { document.getElementById("game").style.visibility = ""; });

        // A tap where the light is still presses the button (the deck), or the game (sideways).
        const at = await page.evaluate((sideways) => {
          const target = sideways ? document.getElementById("game-stage") : document.getElementById("arcade");
          const b = target.getBoundingClientRect();
          return { x: b.left + b.width * (sideways ? 0.5 : 0.36), y: b.top + 12 };
        }, sideways);
        const from = await page.evaluate(() => window.__posted.length);
        await page.touchscreen.tap(at.x, at.y);
        await sleep(200);
        const presses = (await page.evaluate((n) => window.__posted.slice(n), from)).filter((m) => m.t === "press");
        check(presses.length === 2 && presses[0].down === true, `${name}: a tap in the light presses the ${sideways ? "game" : "button"} (${presses.length} messages)`);
      }
    }

    // The board's pip, lit by an app: the light follows the colour the page shows it in.
    const pip = await page.evaluate(() => { vesper.lights.setBoard([0, 200, 255]); vesper.bridge.command("board_led", { values: vesper.lights.boardDesired }); return window.__lamps()[4]; });
    check(!pip.hidden && pip.a > 0 && pip.hue === pip.want.hue && Math.abs(pip.a - pip.want.a) < 0.002, `${name}: the board's pip glows in the colour the page paints it ${JSON.stringify(pip)}`);
    await page.screenshot({ path: path.join(output, `${name}-game-board.png`) });

    // Real apps light the lamps: Lantern's scene and Echo Vault's cues.
    await page.evaluate(() => { vesper.lights.suspendedUntil = 0; vesper.lights.release(); });
    for (const id of ["lantern", "echo"]) {
      await page.evaluate((id) => vesper.launch(id), id);
      await sleep(500);
      // Lantern lights on its first hold; Echo Vault starts on a press and then plays its cues.
      if (id === "lantern") { await page.keyboard.down("Space"); await sleep(900); await page.keyboard.up("Space"); }
      else { await page.keyboard.down("Space"); await sleep(80); await page.keyboard.up("Space"); }
      let seen = 0, samples = 0, disagree = [], shot = false;
      for (let t = 0; t < 40; t++) {
        await sleep(100);
        const lamps = await page.evaluate(() => window.__lamps());
        samples++;
        const wrong = lamps.filter((l) => l.hue !== l.want.hue || Math.abs(l.a - l.want.a) > 0.002);
        if (wrong.length) disagree.push(JSON.stringify(wrong[0]));
        if (lamps.some((l) => l.a > 0)) {
          seen++;
          if (!shot) { shot = true; await page.screenshot({ path: path.join(output, `${name}-${id}.png`) }); }
        }
      }
      check(seen > 0, `${name} ${id}: the app lit the lamps and their light (${seen} of ${samples} samples)`);
      check(disagree.length === 0, `${name} ${id}: the light always matched the lamps as painted ${disagree.slice(0, 1)}`);
    }

    const hostErrors = await page.evaluate(() => vesper.errors || []);
    check(!errors.length && !hostErrors.length, `${name}: no page or console errors ${JSON.stringify({ errors, hostErrors })}`);
    await context.close();
  }

  finish(output, "ios-lamps-browser");
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => browser?.close());
