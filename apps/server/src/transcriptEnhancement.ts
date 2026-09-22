import type { TranscriptResult } from "@jiko/protocol";

const CONTROL_TOKEN_PATTERN = /<\|[^|>]{1,48}\|>/g;
const ZERO_WIDTH_FORMAT_PATTERN = /[\u200b\u2060\ufeff]/g;
const TYPOGRAPHIC_APOSTROPHE_PATTERN = /[\u2018\u2019\u02bc]/g;
const LEADING_FILLER_PATTERN = /^(?:(?:嗯+|呃+|额+|唔+)|(?:um+|uh+|erm+))[,，。.!?！？；;\s]*/iu;
const BOUNDED_FILLER_PATTERN = /([,，。.!?！？；;\s])(?:(?:嗯+|呃+|额+|唔+)|(?:um+|uh+|erm+))(?=[,，。.!?！？；;\s]|$)/giu;

export function enhanceTranscript(transcript: TranscriptResult): TranscriptResult {
  const transforms: string[] = [];
  let semanticText = transcript.text;

  const unicodeNormalized = semanticText.normalize("NFC");
  if (unicodeNormalized !== semanticText) {
    transforms.push("unicode_nfc");
    semanticText = unicodeNormalized;
  }

  // Full NFKC also rewrites meaningful CJK punctuation such as the ellipsis.
  // Fold only full-width letters and digits needed by the content rules.
  const withFoldedAlphanumerics = foldFullWidthAlphanumerics(semanticText);
  if (withFoldedAlphanumerics !== semanticText) {
    transforms.push("fullwidth_alphanumeric_folded");
    semanticText = withFoldedAlphanumerics;
  }

  const withoutControlTokens = semanticText.replace(CONTROL_TOKEN_PATTERN, "");
  if (withoutControlTokens !== semanticText) {
    transforms.push("provider_control_tokens_removed");
    semanticText = withoutControlTokens;
  }

  const withoutZeroWidthFormatting = semanticText.replace(
    ZERO_WIDTH_FORMAT_PATTERN,
    ""
  );
  if (withoutZeroWidthFormatting !== semanticText) {
    transforms.push("zero_width_format_removed");
    semanticText = withoutZeroWidthFormatting;
  }

  // ASR providers disagree about straight versus typographic apostrophes.
  // Canonicalizing them makes bounded English negation rules stable without
  // rewriting any words or inferred punctuation.
  const withCanonicalApostrophes = semanticText.replace(
    TYPOGRAPHIC_APOSTROPHE_PATTERN,
    "'"
  );
  if (withCanonicalApostrophes !== semanticText) {
    transforms.push("typographic_apostrophe_normalized");
    semanticText = withCanonicalApostrophes;
  }

  const withoutLeadingFiller = semanticText.replace(LEADING_FILLER_PATTERN, "");
  const withoutFillers = withoutLeadingFiller.replace(
    BOUNDED_FILLER_PATTERN,
    "$1"
  );
  if (withoutFillers !== semanticText) {
    transforms.push("bounded_fillers_removed");
    semanticText = withoutFillers;
  }

  const whitespaceNormalized = semanticText
    .replace(/\s+/g, " ")
    .replace(/\s+([,，。.!?！？；;])/g, "$1")
    .trim();
  if (whitespaceNormalized !== semanticText) {
    transforms.push("whitespace_normalized");
    semanticText = whitespaceNormalized;
  }

  return {
    ...transcript,
    semanticText,
    enhancement: {
      id: "jiko-semantic-view-v1",
      transforms
    }
  };
}

function foldFullWidthAlphanumerics(value: string): string {
  return value.replace(/[０-９Ａ-Ｚａ-ｚ]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) - 0xfee0)
  );
}
