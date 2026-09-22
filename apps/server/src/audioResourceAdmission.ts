const defaultMaxIngressBytes = 24 * 1024 * 1024;
const defaultMaxIngressLeases = 16;
const defaultMaxPipelineBytes = 24 * 1024 * 1024;
const defaultMaxPipelines = 1;

export type AudioResourceAdmissionOptions = {
  maxIngressBytes?: number;
  maxIngressLeases?: number;
  maxPipelineBytes?: number;
  maxPipelines?: number;
};

export type AudioResourceAdmissionSnapshot = {
  ingress: {
    reservedBytes: number;
    maxBytes: number;
    activeLeases: number;
    maxLeases: number;
    rejectedReservations: number;
    rejectedSlotReservations: number;
  };
  pipeline: {
    reservedBytes: number;
    maxBytes: number;
    activeLeases: number;
    maxLeases: number;
    rejectedByteReservations: number;
    rejectedSlotReservations: number;
  };
};

export type AudioResourceKind =
  | "ingress_bytes"
  | "ingress_slots"
  | "pipeline_bytes"
  | "pipeline_slots";

export class AudioResourceCapacityError extends Error {
  readonly code = "audio_resource_capacity_exceeded";

  constructor(
    readonly resource: AudioResourceKind,
    message: string
  ) {
    super(message);
    this.name = "AudioResourceCapacityError";
  }
}

/**
 * One process-wide, synchronous admission boundary for audio bytes and work.
 * Node runs these methods to completion on one event-loop turn, so two HTTP or
 * WebSocket callbacks cannot both observe and consume the same capacity.
 */
export class AudioResourceAdmission {
  private readonly maxIngressBytes: number;
  private readonly maxIngressLeases: number;
  private readonly maxPipelineBytes: number;
  private readonly maxPipelines: number;
  private ingressBytes = 0;
  private pipelineBytes = 0;
  private ingressLeases = 0;
  private pipelineLeases = 0;
  private rejectedIngressReservations = 0;
  private rejectedIngressSlotReservations = 0;
  private rejectedPipelineByteReservations = 0;
  private rejectedPipelineSlotReservations = 0;

  constructor(options: AudioResourceAdmissionOptions = {}) {
    this.maxIngressBytes = resolvedPositiveInteger(
      options.maxIngressBytes,
      configuredPositiveInteger("JIKO_AUDIO_MAX_INGRESS_BYTES") ??
        defaultMaxIngressBytes,
      "maxIngressBytes"
    );
    this.maxIngressLeases = resolvedPositiveInteger(
      options.maxIngressLeases,
      configuredPositiveInteger("JIKO_AUDIO_MAX_INGRESS_LEASES") ??
        defaultMaxIngressLeases,
      "maxIngressLeases"
    );
    this.maxPipelineBytes = resolvedPositiveInteger(
      options.maxPipelineBytes,
      configuredPositiveInteger("JIKO_AUDIO_MAX_PIPELINE_BYTES") ??
        defaultMaxPipelineBytes,
      "maxPipelineBytes"
    );
    this.maxPipelines = resolvedPositiveInteger(
      options.maxPipelines,
      configuredPositiveInteger("JIKO_AUDIO_MAX_PIPELINES") ??
        defaultMaxPipelines,
      "maxPipelines"
    );
  }

  beginIngress(): AudioIngressLease {
    if (this.ingressLeases >= this.maxIngressLeases) {
      this.rejectedIngressSlotReservations += 1;
      throw new AudioResourceCapacityError(
        "ingress_slots",
        `Audio ingress concurrency limit (${this.maxIngressLeases}) was exceeded`
      );
    }
    this.ingressLeases += 1;
    return new AudioIngressLease(this);
  }

  acquirePipeline(bodyBytes: number): AudioPipelineLease {
    assertNonnegativeSafeInteger(bodyBytes, "pipeline bodyBytes");
    if (this.pipelineLeases >= this.maxPipelines) {
      this.rejectedPipelineSlotReservations += 1;
      throw new AudioResourceCapacityError(
        "pipeline_slots",
        `Audio pipeline concurrency limit (${this.maxPipelines}) was exceeded`
      );
    }
    if (exceedsCombinedLimit(this.pipelineBytes, bodyBytes, this.maxPipelineBytes)) {
      this.rejectedPipelineByteReservations += 1;
      throw new AudioResourceCapacityError(
        "pipeline_bytes",
        `Audio pipeline byte capacity (${this.maxPipelineBytes}) was exceeded`
      );
    }

    this.pipelineLeases += 1;
    this.pipelineBytes += bodyBytes;
    return new AudioPipelineLease(this, bodyBytes);
  }

  snapshot(): AudioResourceAdmissionSnapshot {
    return {
      ingress: {
        reservedBytes: this.ingressBytes,
        maxBytes: this.maxIngressBytes,
        activeLeases: this.ingressLeases,
        maxLeases: this.maxIngressLeases,
        rejectedReservations: this.rejectedIngressReservations,
        rejectedSlotReservations: this.rejectedIngressSlotReservations
      },
      pipeline: {
        reservedBytes: this.pipelineBytes,
        maxBytes: this.maxPipelineBytes,
        activeLeases: this.pipelineLeases,
        maxLeases: this.maxPipelines,
        rejectedByteReservations: this.rejectedPipelineByteReservations,
        rejectedSlotReservations: this.rejectedPipelineSlotReservations
      }
    };
  }

  reserveIngress(bytes: number): void {
    assertNonnegativeSafeInteger(bytes, "ingress bytes");
    if (exceedsCombinedLimit(this.ingressBytes, bytes, this.maxIngressBytes)) {
      this.rejectedIngressReservations += 1;
      throw new AudioResourceCapacityError(
        "ingress_bytes",
        `Audio ingress byte capacity (${this.maxIngressBytes}) was exceeded`
      );
    }
    this.ingressBytes += bytes;
  }

  releaseIngress(bytes: number): void {
    this.ingressBytes -= bytes;
    this.ingressLeases -= 1;
    this.assertCounters();
  }

  releasePipeline(bytes: number): void {
    this.pipelineBytes -= bytes;
    this.pipelineLeases -= 1;
    this.assertCounters();
  }

  private assertCounters(): void {
    if (
      this.ingressBytes < 0 ||
      this.pipelineBytes < 0 ||
      this.ingressLeases < 0 ||
      this.pipelineLeases < 0
    ) {
      throw new Error("Audio admission lease accounting underflowed");
    }
  }
}

export class AudioIngressLease {
  private reservedBytes = 0;
  private released = false;

  constructor(private readonly owner: AudioResourceAdmission) {}

  reserve(bytes: number): void {
    if (this.released) {
      throw new Error("Audio ingress lease was already released");
    }
    this.owner.reserveIngress(bytes);
    this.reservedBytes += bytes;
  }

  release(): void {
    if (this.released) {
      return;
    }
    this.released = true;
    this.owner.releaseIngress(this.reservedBytes);
    this.reservedBytes = 0;
  }
}

export class AudioPipelineLease {
  private released = false;

  constructor(
    private readonly owner: AudioResourceAdmission,
    private readonly reservedBytes: number
  ) {}

  release(): void {
    if (this.released) {
      return;
    }
    this.released = true;
    this.owner.releasePipeline(this.reservedBytes);
  }
}

function exceedsCombinedLimit(
  current: number,
  additional: number,
  limit: number
): boolean {
  return current > limit || additional > limit - current;
}

function assertNonnegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a nonnegative safe integer`);
  }
}

function configuredPositiveInteger(name: string): number | undefined {
  const configured = process.env[name];
  if (configured === undefined) {
    return undefined;
  }
  const rawValue = configured.trim();
  const parsed = Number(rawValue);
  if (!rawValue || !Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return parsed;
}

function resolvedPositiveInteger(
  value: number | undefined,
  fallback: number,
  label: string
): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}
