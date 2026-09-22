import test from "node:test";
import assert from "node:assert/strict";

import { enhanceTranscript } from "../dist/transcriptEnhancement.js";

test("semantic transcript removes bounded filler while preserving faithful text and negation", () => {
  const transcript = enhanceTranscript({
    text: "嗯，我不想辞职",
    language: "zh",
    provider: "local:test"
  });

  assert.equal(transcript.text, "嗯，我不想辞职");
  assert.equal(transcript.semanticText, "我不想辞职");
  assert.deepEqual(transcript.enhancement.transforms, ["bounded_fillers_removed"]);
});

test("semantic transcript can be empty while preserving a faithful filler-only result", () => {
  const transcript = enhanceTranscript({
    text: "嗯。",
    language: "zh",
    provider: "local:test"
  });

  assert.equal(transcript.text, "嗯。");
  assert.equal(transcript.semanticText, "");
  assert.deepEqual(transcript.enhancement.transforms, ["bounded_fillers_removed"]);
});

test("semantic transcript strips provider control tokens without generative rewriting", () => {
  const transcript = enhanceTranscript({
    text: "<|zh|><|NEUTRAL|> 我还是先留下",
    provider: "local:test"
  });

  assert.equal(transcript.semanticText, "我还是先留下");
  assert.deepEqual(transcript.enhancement.transforms, [
    "provider_control_tokens_removed",
    "whitespace_normalized"
  ]);
});

test("semantic transcript folds compatibility forms but preserves faithful provider text", () => {
  const faithful = "Ｉ don’t want to stay\u200b";
  const transcript = enhanceTranscript({
    text: faithful,
    provider: "local:test"
  });

  assert.equal(transcript.text, faithful);
  assert.equal(transcript.semanticText, "I don't want to stay");
  assert.deepEqual(transcript.enhancement.transforms, [
    "fullwidth_alphanumeric_folded",
    "zero_width_format_removed",
    "typographic_apostrophe_normalized"
  ]);
});

test("semantic transcript preserves punctuation and repeated words", () => {
  const transcript = enhanceTranscript({
    text: "我、我不想走……真的不想。",
    provider: "local:test"
  });

  assert.equal(transcript.semanticText, "我、我不想走……真的不想。");
  assert.deepEqual(transcript.enhancement.transforms, []);
});
