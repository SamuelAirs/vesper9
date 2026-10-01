// node tests/helpers/outpost-sim-cli.mjs [runs] [activeSeconds] — prints the bot's timeline.
import { simulate } from "./outpost-bot.mjs";

const runs = Number(process.argv[2]) || 3, active = Number(process.argv[3]) || 150;
const { res } = simulate({ runs, active });
for (const r of res) console.log(JSON.stringify(r, (k, v) => (typeof v === "number" && !Number.isInteger(v) ? Number(v.toPrecision(4)) : v)));
