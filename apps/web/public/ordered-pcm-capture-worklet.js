const PROCESSOR_NAME = "jiko-ordered-pcm-capture";
const DEFAULT_FRAME_DURATION_MS = 20;
const CONTRACT_VERSION = 2;

class OrderedPcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const configuredFrameDurationMs =
      options?.processorOptions?.frameDurationMs ?? DEFAULT_FRAME_DURATION_MS;
    this.frameSize = Math.max(
      1,
      Math.round(sampleRate * configuredFrameDurationMs / 1_000),
    );
    this.frameBuffer = new ArrayBuffer(this.frameSize * 2);
    this.frameView = new DataView(this.frameBuffer);
    this.frameOffset = 0;
    this.captureGapCount = 0;
    this.droppedFrameCount = 0;
    this.overflowCount = 0;
    this.frameCredits = 0;
    this.expectedRenderFrame = undefined;
    this.sourceFrameCursor = 0;
    this.sourceMonotonicOriginMs = 0;
    this.armed = false;
    this.warmupExpectedRenderFrame = undefined;
    this.stableWarmupQuanta = 0;
    this.readyPosted = false;
    this.stopping = false;

    this.port.onmessage = (event) => {
      if (event.data?.type === "capture.arm" && !this.armed && !this.stopping) {
        this.armed = true;
        this.expectedRenderFrame = undefined;
        this.sourceFrameCursor = 0;
        this.captureGapCount = 0;
        this.droppedFrameCount = 0;
        this.overflowCount = 0;
        this.frameCredits = Math.max(
          0,
          Math.floor(event.data.frameCredits ?? 0),
        );
        this.frameOffset = 0;
        this.sourceMonotonicOriginMs = Math.max(
          0,
          event.data.sourceMonotonicOriginMs ?? 0,
        );
        return;
      }
      if (
        event.data?.type === "capture.credit" &&
        this.armed &&
        !this.stopping
      ) {
        const returnedCredits = Math.max(
          0,
          Math.floor(event.data.frameCount ?? 0),
        );
        this.frameCredits = Math.min(32, this.frameCredits + returnedCredits);
        return;
      }
      if (event.data?.type !== "capture.stop" || this.stopping) {
        return;
      }

      this.stopping = true;
      this.flushFrame();
      this.port.postMessage({
        type: "capture.stopped",
        captureGapCount: this.captureGapCount,
        droppedFrameCount: this.droppedFrameCount,
        overflowCount: this.overflowCount,
      });
    };
  }

  process(inputs) {
    if (this.stopping) {
      return false;
    }

    const channels = inputs[0];
    const renderQuantumFrames = channels?.[0]?.length ?? 128;
    const hasCompleteInput = Boolean(
      channels &&
      channels.length > 0 &&
      channels.every((channel) => channel?.length === renderQuantumFrames),
    );
    if (!this.armed) {
      if (hasCompleteInput && renderQuantumFrames > 0) {
        this.stableWarmupQuanta =
          this.warmupExpectedRenderFrame === undefined ||
          currentFrame === this.warmupExpectedRenderFrame
            ? this.stableWarmupQuanta + 1
            : 1;
        this.warmupExpectedRenderFrame = currentFrame + renderQuantumFrames;
        if (this.stableWarmupQuanta >= 8 && !this.readyPosted) {
          this.readyPosted = true;
          this.port.postMessage({
            type: "capture.ready",
            contractVersion: CONTRACT_VERSION,
          });
        }
      } else {
        this.stableWarmupQuanta = 0;
        this.warmupExpectedRenderFrame = undefined;
      }
      return true;
    }

    if (
      this.expectedRenderFrame !== undefined &&
      currentFrame > this.expectedRenderFrame
    ) {
      const missingFrames = currentFrame - this.expectedRenderFrame;
      this.captureGapCount += 1;
      this.droppedFrameCount += missingFrames;
      this.sourceFrameCursor += missingFrames;
    }
    this.expectedRenderFrame = currentFrame + renderQuantumFrames;

    if (!hasCompleteInput || !channels || renderQuantumFrames === 0) {
      this.captureGapCount += 1;
      this.droppedFrameCount += renderQuantumFrames;
      this.sourceFrameCursor += renderQuantumFrames;
      return true;
    }

    for (let frameIndex = 0; frameIndex < renderQuantumFrames; frameIndex += 1) {
      let monoSample = 0;
      for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
        monoSample += channels[channelIndex]?.[frameIndex] ?? 0;
      }
      monoSample /= channels.length;

      const clamped = Math.max(-1, Math.min(1, monoSample));
      const integerSample = clamped < 0
        ? Math.round(clamped * 0x8000)
        : Math.round(clamped * 0x7fff);
      this.frameView.setInt16(this.frameOffset * 2, integerSample, true);
      this.frameOffset += 1;
      this.sourceFrameCursor += 1;

      if (this.frameOffset === this.frameSize) {
        this.flushFrame();
      }
    }

    return true;
  }

  flushFrame() {
    if (this.frameOffset === 0) {
      return;
    }

    if (this.frameCredits <= 0) {
      this.droppedFrameCount += this.frameOffset;
      this.overflowCount += 1;
      this.frameBuffer = new ArrayBuffer(this.frameSize * 2);
      this.frameView = new DataView(this.frameBuffer);
      this.frameOffset = 0;
      return;
    }

    const pcmBuffer = this.frameOffset === this.frameSize
      ? this.frameBuffer
      : this.frameBuffer.slice(0, this.frameOffset * 2);
    this.port.postMessage(
      {
        type: "pcm.frame",
        pcmBuffer,
        frameCount: this.frameOffset,
        sourceMonotonicMs:
          this.sourceMonotonicOriginMs +
          this.sourceFrameCursor * 1_000 / sampleRate,
        captureGapCount: this.captureGapCount,
        droppedFrameCount: this.droppedFrameCount,
        overflowCount: this.overflowCount,
      },
      [pcmBuffer],
    );
    this.frameCredits -= 1;
    this.frameBuffer = new ArrayBuffer(this.frameSize * 2);
    this.frameView = new DataView(this.frameBuffer);
    this.frameOffset = 0;
  }
}

registerProcessor(PROCESSOR_NAME, OrderedPcmCaptureProcessor);
