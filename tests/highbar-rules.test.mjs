import test from "node:test";
import assert from "node:assert/strict";
import { migrateSave } from "../web/apps/highbar.js";
import { PARKS, LINES } from "../web/apps/highbar-content.js";

const matrix = (n, value) => PARKS.map(() => Array(n).fill(value));
function archive(version, width = 3) {
  return { bestCombo: 1e9, [version === "style-v2" ? "styleBest" : "flowBest"]: [1e9, 1e9, 1e9, 1e9],
    lineBest: matrix(width, 1e9), lineComboBest: matrix(width, 1e9), lineTimeBest: matrix(width, 127.99) };
}
function releasedCareer(i) {
  return { scoreVersion: "flow-v4", ...archive("flow-v4", 4),
    legacyRecords: { styleV2: archive("style-v2"), flowV3: archive("flow-v3") },
    runs: 100 + i, clean: 30 + i, guided: true, mode: 1, line: 2, park: 3,
    best: [8, 7, 6, 5], styleBest: [5, 6, 7, 8],
    goals: PARKS.map(p => p.goals.map((_, i) => i)), lines: PARKS.map(() => [0, 1, 2, 3]),
    lineMedals: matrix(4, 3), medals: [3, 3, 3, 3], last: { score: 444 + i, combo: 333 + i, park: "THE TOWER" } };
}
function serviceJSON(value) {
  if (Array.isArray(value)) return "[" + value.map(serviceJSON).join(", ") + "]";
  if (value && typeof value === "object") return "{" + Object.entries(value).map(([k,v]) => serviceJSON(k) + ": " + serviceJSON(v)).join(", ") + "}";
  return JSON.stringify(value).replace(/[^\x00-\x7f]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

test("momentum rules preserve every released career and its three historical score epochs", () => {
  const old = { schema: 4, scoreVersion: "flow-v4", slot: 2, slots: [0, 1, 2].map(releasedCareer) };
  const before = structuredClone(old), save = migrateSave(old);
  assert.equal(save.schema, 5); assert.equal(save.scoreVersion, "flow-v5"); assert.equal(save.slot, 2);
  for (let i = 0; i < 3; i++) {
    const slot = save.slots[i];
    for (const field of ["runs", "clean", "guided", "mode", "line", "park", "goals", "lines", "best", "styleBest", "medals", "lineMedals", "last"]) {
      assert.deepEqual(slot[field], old.slots[i][field], field);
    }
    assert.deepEqual(slot.legacyRecords.styleV2, archive("style-v2"));
    assert.deepEqual(slot.legacyRecords.flowV3, archive("flow-v3"));
    assert.deepEqual(slot.legacyRecords.flowV4, archive("flow-v4", 4));
    assert.equal(slot.bestCombo, 0); assert.deepEqual(slot.flowBest, [0, 0, 0, 0]);
    for (const key of ["lineBest", "lineComboBest", "lineTimeBest"]) assert.deepEqual(slot[key], matrix(4, 0));
  }
  assert.deepEqual(migrateSave(save), save); assert.deepEqual(old, before);
  save.slots[0].legacyRecords.flowV4.lineBest[0][0] = 7;
  assert.equal(save.slots[1].legacyRecords.flowV4.lineBest[0][0], 1e9);
});

test("three full current careers and all archives fit the High Bar service bound", () => {
  const migrated = migrateSave({ schema: 4, slots: [0, 1, 2].map(releasedCareer) });
  for (const slot of migrated.slots) {
    Object.assign(slot, archive("flow-v5", 4), { runs: 1e7, clean: 1e7,
      best: [1e9,1e9,1e9,1e9], styleBest: [1e9,1e9,1e9,1e9],
      last: { score: 1e9, combo: 1e9, park: "界".repeat(24) } });
  }
  const save = migrateSave(migrated), payload = serviceJSON(save);
  assert.ok(Buffer.byteLength(payload, "utf8") <= 16384);
  assert.deepEqual(migrateSave(save), save); assert.deepEqual(JSON.parse(payload), save);
});

test("no current park challenge requires a retired manual", () => {
  assert.ok(LINES.flat().every(line => !line.manual));
  assert.equal(LINES[0][2].airs, 2); assert.equal(LINES[0][2].shove, true);
});
