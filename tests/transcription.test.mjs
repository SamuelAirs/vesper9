// Field Notes with the two-pass recogniser: provisional Vosk text until the refined line replaces it.
import test from "node:test";
import assert from "node:assert/strict";
import { Transcription } from "../web/apps/utilities.js";
import { microphoneStatus, recognizerLabel } from "../web/engine/status.js";
import { appContext } from "./helpers/app-context.mjs";

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

function notes(saved) {
  const ctx = appContext({
    state: { mic: { mode: "transcribe", session: "s1", recognizer: { engine: "vosk+parakeet", refine: "ready", detail: null } } },
    get: (path) => (path.startsWith("sessions") ? [{ id: "s1", started: 1, lines: saved.length }] : saved.map((text) => ({ text }))),
  });
  return { ctx, app: new Transcription(ctx) };
}
const last = (ctx) => ctx.calls.content.at(-1);

test("a Vosk final line stays visible as provisional text until its refined line is saved", async () => {
  const saved = [];
  const { ctx, app } = notes(saved); await settle();
  app.event({ type: "speech", text: "hello wurld", final: false, provisional: true, utt: 1, mode: "transcribe" });
  assert.match(last(ctx), /hello wurld/);
  app.event({ type: "speech", text: "and a partial", final: false, mode: "transcribe" });
  assert.match(last(ctx), /hello wurld\nand a partial/, "the next utterance's live text follows the provisional line");
  saved.push("Hello world.");
  app.event({ type: "speech", text: "Hello world.", final: true, utt: 1, session: "s1", mode: "transcribe" });
  await settle();
  assert.match(last(ctx), /Hello world\./);
  assert.doesNotMatch(last(ctx), /hello wurld/, "the provisional text is gone once the refined line is shown");
  assert.match(last(ctx), /and a partial/, "a refined line for an earlier utterance does not wipe the live partial");
});

test("the provisional text is not dropped before the saved lines include the refined one", async () => {
  const saved = [];
  const { ctx, app } = notes(saved); await settle();
  app.event({ type: "speech", text: "one moment", final: false, provisional: true, utt: 4, mode: "transcribe" });
  saved.push("One moment.");
  app.event({ type: "speech", text: "One moment.", final: true, utt: 4, session: "s1" });
  assert.match(last(ctx), /one moment/, "still shown while the reload is in flight");
  await settle();
  assert.doesNotMatch(last(ctx), /one moment/);
  assert.match(last(ctx), /One moment\./);
});

test("an utterance whose final text is empty simply removes the provisional line", async () => {
  const { ctx, app } = notes([]); await settle();
  app.event({ type: "speech", text: "uh", final: false, provisional: true, utt: 2 });
  app.event({ type: "speech", text: "", final: true, utt: 2 });
  assert.doesNotMatch(last(ctx), /uh/);
});

test("without a second pass finals behave as before and stopping clears provisional text", async () => {
  const saved = [];
  const { ctx, app } = notes(saved); await settle();
  app.event({ type: "speech", text: "plain", final: false, mode: "transcribe" });
  saved.push("plain text");
  app.event({ type: "speech", text: "plain text", final: true, session: "s1", engine: "vosk" });
  await settle();
  assert.match(last(ctx), /plain text/);
  app.event({ type: "speech", text: "left over", final: false, provisional: true, utt: 9 });
  app.event({ type: "mic", mode: "off", session: undefined }); await settle();
  assert.doesNotMatch(last(ctx), /left over/);
});

test("the screen says which recognisers are in use and when the model is loading", () => {
  const state = (refine, mode = "transcribe") => ({ device: { connected: true, capture: true }, mic: { mode, recognizer: { refine } } });
  assert.equal(microphoneStatus(state("loading")).label, "TRANSCRIBING / LOADING");
  assert.equal(microphoneStatus(state("ready")).label, "TRANSCRIBING");
  assert.equal(microphoneStatus(state("loading", "commands")).label, "VOICE ON");
  assert.match(recognizerLabel(state("unavailable")), /VOSK ONLY/);
  assert.match(recognizerLabel(state("ready")), /PARAKEET FINAL/);
  assert.match(recognizerLabel(state("failed")), /SECOND PASS FAILED/);
});
