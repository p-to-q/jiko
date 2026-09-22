export function createFakeStreamingSttAdapter(options = {}) {
  const calls = {
    opens: [],
    pushes: [],
    finishes: [],
    cancellations: []
  };
  let emit;
  let openInput;
  let revision = 0;

  const adapter = {
    id: options.id ?? "local:fake-streaming-stt",
    remote: options.remote ?? false,
    async open(input) {
      openInput = input;
      emit = input.emit;
      calls.opens.push(input);
      if (options.openGate) {
        await options.openGate.promise;
      }
      if (options.openError) {
        throw options.openError;
      }

      return {
        async push(chunk) {
          calls.pushes.push(chunk);
          if (options.pushGate) {
            await options.pushGate.promise;
          }
          if (options.emitPartialOnPush !== false) {
            revision += 1;
            input.emit({
              ...input.identity,
              type: "partial",
              revision,
              coverageSequence: chunk.sequence,
              text: options.partialText?.(chunk, revision) ?? `partial ${revision}`,
              language: "en"
            });
          }
        },
        async finish(finishInput) {
          calls.finishes.push(finishInput);
          if (options.finishGate) {
            await options.finishGate.promise;
          }
          if (options.finishError) {
            throw options.finishError;
          }
          if (!options.finishWithoutFinal) {
            input.emit({
              ...input.identity,
              ...(options.finalIdentity ?? {}),
              type: "final",
              finalSequence: options.finalSequence ?? finishInput.finalSequence,
              text: options.finalText ?? "accepted final",
              language: "en",
              confidence: 0.8
            });
          }
          if (options.duplicateFinal) {
            input.emit({
              ...input.identity,
              type: "final",
              finalSequence: finishInput.finalSequence,
              text: "duplicate final",
              language: "en"
            });
          }
        },
        async cancel(reason) {
          calls.cancellations.push(reason);
        }
      };
    }
  };

  return {
    adapter,
    calls,
    emit(event) {
      if (!emit) {
        throw new Error("Fake streaming adapter has not opened");
      }
      emit(event);
    },
    get openInput() {
      return openInput;
    }
  };
}

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

export const fakeStreamingIdentity = Object.freeze({
  sessionId: "streaming-session",
  attemptId: "streaming-attempt",
  sourceId: "streaming-source",
  audioProfileHash: "a".repeat(64)
});

export const fakeStreamingProfile = Object.freeze({
  sampleFormat: "s16le",
  sampleRateHz: 16_000,
  channelCount: 1
});

export function fakeStreamingChunk(sequence, options = {}) {
  const frameCount = options.frameCount ?? 2;
  return {
    ...fakeStreamingIdentity,
    sequence,
    sourceMonotonicMs: options.sourceMonotonicMs ?? sequence * 20,
    frameCount,
    pcmBytes: options.pcmBytes ?? new Uint8Array(frameCount * 2).fill(sequence)
  };
}

export function fakeStreamingFinish(finalSequence, options = {}) {
  return {
    ...fakeStreamingIdentity,
    finalSequence,
    sourceMonotonicMs: options.sourceMonotonicMs ?? finalSequence * 20,
    ...(options.expiresAtMs === undefined
      ? {}
      : { expiresAtMs: options.expiresAtMs })
  };
}
