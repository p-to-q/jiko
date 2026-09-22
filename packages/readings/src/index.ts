export type ReadingChannel = "text" | "voice" | "timing";

export type SignalState = "maintain" | "deviate" | "static";

export type ReadingFeatureValue = number | string | boolean;

export type ReadingFeatures = Record<string, ReadingFeatureValue>;

export type Reading = {
  channel: ReadingChannel;
  state: SignalState;
  confidence: number;
  features: ReadingFeatures;
  privateReason?: string;
};

export type TextReadingInput = {
  transcript?: string | null;
  language?: string;
  sttConfidence?: number;
};

export type VoiceReadingInput = {
  durationMs?: number;
  speechMs?: number;
  silenceMs?: number;
  pauseCount?: number;
  longestPauseMs?: number;
  rmsMean?: number;
  rmsStd?: number;
  rmsPeak?: number;
  pitchMeanHz?: number;
  pitchStdHz?: number;
  clipping?: boolean;
  noisy?: boolean;
};

export type TimingReadingInput = {
  durationMs?: number;
  speechMs?: number;
  preSpeechDelayMs?: number;
  pauseCount?: number;
  longestPauseMs?: number;
};

export type ReadingsInput = {
  text?: TextReadingInput;
  voice?: VoiceReadingInput;
  timing?: TimingReadingInput;
};

const TEXT_MIN_CHARS = 3;

const CHINESE_NEGATION_PREFIXES = [
  "不",
  "没",
  "别",
  "不要",
  "不想",
  "不愿",
  "不会",
  "不能",
  "不该",
  "不打算",
  "不是想",
  "并不想",
  "没想过"
];

const ENGLISH_NEGATION_PREFIXES = [
  "no",
  "not",
  "never",
  "cannot",
  "can't",
  "won't",
  "don't",
  "do not",
  "not want to",
  "never want to",
  "do not want to",
  "don't want to",
  "not plan to",
  "do not plan to",
  "don't plan to",
  "not going to"
];

const MAINTAIN_KEYWORDS = [
  "avoid",
  "delay",
  "safe",
  "safety",
  "stay",
  "later",
  "maybe later",
  "return",
  "back",
  "not now",
  "hold",
  "wait",
  "维持",
  "保持",
  "避免",
  "回避",
  "推迟",
  "延迟",
  "安全",
  "稳妥",
  "算了",
  "还是",
  "以后",
  "晚点",
  "暂时",
  "不去",
  "不说",
  "不做",
  "先别",
  "回去",
  "留下"
];

const DEVIATE_KEYWORDS = [
  "motion",
  "move",
  "rupture",
  "attempt",
  "try",
  "quit",
  "leave",
  "confess",
  "ask",
  "go",
  "start",
  "change",
  "break",
  "say it",
  "行动",
  "移动",
  "偏离",
  "破裂",
  "撕开",
  "试试",
  "尝试",
  "离开",
  "辞职",
  "说出来",
  "去问",
  "想问",
  "问问",
  "问清楚",
  "开口问",
  "想走",
  "走开",
  "出发",
  "迈出",
  "开始",
  "改变",
  "打破"
];

export function readText(input: TextReadingInput = {}): Reading {
  const transcript = normalizeTranscript(input.transcript);
  const characterCount = countMeaningfulCharacters(transcript);
  const maintainSignals = matchKeywordsWithNegation(transcript, MAINTAIN_KEYWORDS);
  const deviateSignals = matchKeywordsWithNegation(transcript, DEVIATE_KEYWORDS);
  const maintainMatches = [
    ...maintainSignals.affirmed,
    ...deviateSignals.negated.map(markNegatedKeyword)
  ];
  const deviateMatches = [
    ...deviateSignals.affirmed,
    ...maintainSignals.negated.map(markNegatedKeyword)
  ];
  const sttConfidence = normalizeOptionalNumber(input.sttConfidence);

  const features: ReadingFeatures = {
    language: input.language ?? "unknown",
    characterCount,
    maintainKeywordCount: maintainMatches.length,
    deviateKeywordCount: deviateMatches.length,
    negatedMaintainKeywordCount: maintainSignals.negated.length,
    negatedDeviateKeywordCount: deviateSignals.negated.length
  };

  if (sttConfidence !== undefined) {
    features.sttConfidence = sttConfidence;
    features.sttConfidenceUsage = "telemetry_only";
  }

  if (characterCount < TEXT_MIN_CHARS) {
    return makeReading(
      "text",
      "static",
      0.42,
      features,
      "Transcript is shorter than the minimum readable length."
    );
  }

  if (maintainMatches.length > 0 && deviateMatches.length > 0) {
    return makeReading(
      "text",
      "static",
      0.48,
      {
        ...features,
        matchedKeywords: [...maintainMatches, ...deviateMatches].join(", ")
      },
      "Text contains both maintain and deviate keyword signals."
    );
  }

  if (maintainMatches.length > 0) {
    return makeReading(
      "text",
      "maintain",
      keywordConfidence(maintainMatches.length, deviateMatches.length),
      {
        ...features,
        matchedKeywords: maintainMatches.join(", ")
      },
      `Maintain keywords outweighed deviate keywords: ${maintainMatches.join(", ")}.`
    );
  }

  if (deviateMatches.length > 0) {
    return makeReading(
      "text",
      "deviate",
      keywordConfidence(deviateMatches.length, maintainMatches.length),
      {
        ...features,
        matchedKeywords: deviateMatches.join(", ")
      },
      `Deviate keywords outweighed maintain keywords: ${deviateMatches.join(", ")}.`
    );
  }

  return makeReading(
    "text",
    "static",
    0.4,
    features,
    "Text contains no first-pass keyword signal."
  );
}

export function readVoice(input: VoiceReadingInput = {}): Reading {
  const durationMs = nonNegative(input.durationMs);
  const speechMs = nonNegative(input.speechMs);
  const silenceMs = nonNegative(input.silenceMs);
  const pauseCount = nonNegative(input.pauseCount);
  const longestPauseMs = nonNegative(input.longestPauseMs);
  const rmsMean = nonNegative(input.rmsMean);
  const rmsStd = nonNegative(input.rmsStd);
  const rmsPeak = nonNegative(input.rmsPeak);
  const pitchStdHz = nonNegative(input.pitchStdHz);
  const silenceRatio = ratio(silenceMs, durationMs);
  const rmsVarianceRatio = ratio(rmsStd, rmsMean);

  const features: ReadingFeatures = {
    durationMs,
    speechMs,
    silenceMs,
    silenceRatio,
    pauseCount,
    longestPauseMs,
    rmsMean,
    rmsStd,
    rmsVarianceRatio,
    rmsPeak,
    pitchStdHz,
    clipping: input.clipping === true,
    noisy: input.noisy === true
  };

  if (durationMs < 900 || speechMs < 500 || silenceRatio >= 0.82) {
    return makeReading(
      "voice",
      "static",
      0.5,
      features,
      "Voice signal is too short or mostly silence."
    );
  }

  if (input.clipping === true || input.noisy === true) {
    return makeReading(
      "voice",
      "static",
      0.54,
      features,
      "Voice signal is marked clipped or noisy."
    );
  }

  const maintainSignals = [
    rmsMean > 0 && rmsMean < 0.055,
    rmsVarianceRatio < 0.28,
    pauseCount >= 3,
    longestPauseMs >= 900,
    silenceRatio >= 0.48
  ];

  const deviateSignals = [
    rmsMean >= 0.09,
    rmsVarianceRatio >= 0.35,
    rmsPeak >= 0.22,
    pitchStdHz >= 35,
    pauseCount <= 1 && silenceRatio <= 0.3
  ];

  return scoreSignals(
    "voice",
    features,
    maintainSignals,
    deviateSignals,
    "quiet/low-variance/paused voice features",
    "stronger or more varied voice features"
  );
}

export function readTiming(input: TimingReadingInput = {}): Reading {
  const durationMs = nonNegative(input.durationMs);
  const speechMs = nonNegative(input.speechMs);
  const preSpeechDelayMs = nonNegative(input.preSpeechDelayMs);
  const pauseCount = nonNegative(input.pauseCount);
  const longestPauseMs = nonNegative(input.longestPauseMs);
  const speechRatio = ratio(speechMs, durationMs);

  const features: ReadingFeatures = {
    durationMs,
    speechMs,
    speechRatio,
    preSpeechDelayMs,
    pauseCount,
    longestPauseMs
  };

  if (durationMs < 900 || speechMs < 500) {
    return makeReading(
      "timing",
      "static",
      0.5,
      features,
      "Timing signal is too short to read."
    );
  }

  const maintainSignals = [
    preSpeechDelayMs >= 1200,
    pauseCount >= 3,
    longestPauseMs >= 900,
    speechRatio < 0.45,
    durationMs < 2200 && speechRatio < 0.6
  ];

  const deviateSignals = [
    preSpeechDelayMs <= 450,
    pauseCount <= 1 && speechRatio >= 0.62,
    durationMs >= 3000 && speechRatio >= 0.55,
    longestPauseMs > 0 && longestPauseMs < 500 && speechRatio >= 0.55
  ];

  return scoreSignals(
    "timing",
    features,
    maintainSignals,
    deviateSignals,
    "delayed or interrupted timing features",
    "quick-start or continuing timing features"
  );
}

export function runReadings(input: ReadingsInput): Reading[] {
  return [
    readText(input.text),
    readVoice(input.voice),
    readTiming(input.timing)
  ];
}

function makeReading(
  channel: ReadingChannel,
  state: SignalState,
  confidence: number,
  features: ReadingFeatures,
  privateReason: string
): Reading {
  return {
    channel,
    state,
    confidence: clampConfidence(confidence),
    features,
    privateReason
  };
}

function scoreSignals(
  channel: ReadingChannel,
  features: ReadingFeatures,
  maintainSignals: boolean[],
  deviateSignals: boolean[],
  maintainReason: string,
  deviateReason: string
): Reading {
  const maintainScore = countTrue(maintainSignals);
  const deviateScore = countTrue(deviateSignals);
  const scoredFeatures = {
    ...features,
    maintainSignalCount: maintainScore,
    deviateSignalCount: deviateScore
  };

  if (maintainScore === 0 && deviateScore === 0) {
    return makeReading(
      channel,
      "static",
      0.4,
      scoredFeatures,
      "No first-pass heuristic signal crossed a threshold."
    );
  }

  if (maintainScore === deviateScore) {
    return makeReading(
      channel,
      "static",
      0.47,
      scoredFeatures,
      "Maintain and deviate heuristic signals are balanced."
    );
  }

  if (maintainScore > deviateScore) {
    return makeReading(
      channel,
      "maintain",
      signalConfidence(maintainScore, deviateScore),
      scoredFeatures,
      `Maintain score won from ${maintainReason}.`
    );
  }

  return makeReading(
    channel,
    "deviate",
    signalConfidence(deviateScore, maintainScore),
    scoredFeatures,
    `Deviate score won from ${deviateReason}.`
  );
}

function normalizeTranscript(transcript: string | null | undefined): string {
  return (transcript ?? "").trim().toLowerCase();
}

function countMeaningfulCharacters(transcript: string): number {
  return transcript.replace(/\s+/g, "").length;
}

function matchKeywordsWithNegation(
  transcript: string,
  keywords: string[]
): { affirmed: string[]; negated: string[] } {
  if (transcript.length === 0) {
    return { affirmed: [], negated: [] };
  }

  return keywords.reduce<{ affirmed: string[]; negated: string[] }>(
    (matches, keyword) => {
      const normalizedKeyword = keyword.toLowerCase();
      const indices = keywordIndices(transcript, normalizedKeyword);
      if (indices.length === 0) {
        return matches;
      }

      const polarities = new Set(indices.map((index) => {
        const prefix = transcript.slice(Math.max(0, index - 40), index);
        return hasNegationPrefix(prefix) ? "negated" : "affirmed";
      }));
      if (polarities.has("negated")) {
        matches.negated.push(keyword);
      }
      if (polarities.has("affirmed")) {
        matches.affirmed.push(keyword);
      }

      return matches;
    },
    { affirmed: [], negated: [] }
  );
}

function keywordIndices(transcript: string, keyword: string): number[] {
  const indices: number[] = [];
  let fromIndex = 0;

  while (fromIndex <= transcript.length - keyword.length) {
    const index = transcript.indexOf(keyword, fromIndex);
    if (index < 0) {
      break;
    }

    if (!isAsciiKeyword(keyword) || hasAsciiWordBoundaries(transcript, index, keyword.length)) {
      indices.push(index);
    }
    fromIndex = index + Math.max(1, keyword.length);
  }

  return indices;
}

function isAsciiKeyword(keyword: string): boolean {
  return /^[a-z0-9 '\-]+$/i.test(keyword);
}

function hasAsciiWordBoundaries(
  transcript: string,
  index: number,
  length: number
): boolean {
  const before = transcript[index - 1];
  const after = transcript[index + length];

  return !isAsciiWordCharacter(before) && !isAsciiWordCharacter(after);
}

function isAsciiWordCharacter(value: string | undefined): boolean {
  return value !== undefined && /[a-z0-9_']/i.test(value);
}

function hasNegationPrefix(prefix: string): boolean {
  const trimmed = prefix.trimEnd();
  const chinesePrefix = trimmed.slice(-8);
  if (CHINESE_NEGATION_PREFIXES.some((negation) => chinesePrefix.endsWith(negation))) {
    return true;
  }

  return ENGLISH_NEGATION_PREFIXES.some((negation) => {
    return trimmed === negation || trimmed.endsWith(` ${negation}`);
  });
}

function markNegatedKeyword(keyword: string): string {
  return `not:${keyword}`;
}

function keywordConfidence(primaryMatches: number, secondaryMatches: number): number {
  return 0.48 + Math.min(0.24, primaryMatches * 0.08) - Math.min(0.08, secondaryMatches * 0.04);
}

function signalConfidence(primaryScore: number, secondaryScore: number): number {
  return 0.46 + Math.min(0.26, primaryScore * 0.065) - Math.min(0.08, secondaryScore * 0.035);
}

function clampConfidence(confidence: number): number {
  return Math.max(0, Math.min(0.74, Number(confidence.toFixed(2))));
}

function normalizeOptionalNumber(value: number | undefined): number | undefined {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return undefined;
  }

  return value;
}

function nonNegative(value: number | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value) || value < 0) {
    return 0;
  }

  return value;
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }

  return Number((numerator / denominator).toFixed(3));
}

function countTrue(values: boolean[]): number {
  return values.filter(Boolean).length;
}
