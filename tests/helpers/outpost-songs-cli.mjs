// node tests/helpers/outpost-songs-cli.mjs [generatedSeeds] — prints every melody as note names,
// one phrase per line, to compare against the printed music by eye (and by ear on the device).
import { Outpost } from "../../web/apps/outpost.js";

const M = Outpost.music;
const show = (mel, label, extra = "") => {
  console.log(`\n${label}  [${mel.n.length} notes, ${mel.ends.length} phrases, ${M.noteName(mel.lo)}..${M.noteName(mel.hi)}]${extra}`);
  let from = 0;
  for (const end of mel.ends) {
    console.log("  " + mel.n.slice(from, end + 1).map(M.noteName).join(" "));
    from = end + 1;
  }
};
M.SONGS.forEach((sg, i) => show(M.MEL[i], sg.name, `  ${sg.by}  unlocks at ${sg.at}`));
const seeds = Number(process.argv[2]) || 3;
for (let k = 1; k <= seeds; k++) { const seed = 1000 * k + 7; show(M.genTune(seed), "GENERATED " + M.genName(seed), "  seed " + seed); }
