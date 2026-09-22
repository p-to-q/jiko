import { useEffect, useRef } from "react";

const TARGET_FRAME_MS = 1000 / 12;
const FIRST_BURST_DELAY_MS = 2_200;
const IDLE_BURST_MIN_MS = 14_000;
const IDLE_BURST_SPREAD_MS = 16_000;
const BURST_MIN_MS = 1_100;
const BURST_SPREAD_MS = 550;

const vertexShaderSource = `
attribute vec2 a_position;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const fragmentShaderSource = `
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_pixel_ratio;

float hash(vec2 point) {
  return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  vec2 pixel = gl_FragCoord.xy;
  vec2 uv = pixel / u_resolution;
  vec2 cssPixel = pixel / u_pixel_ratio;

  float fineSand = hash(floor(cssPixel * 0.96) + vec2(7.0, 31.0)) - 0.5;
  float fineSandOffset = hash(floor(cssPixel * 1.18) + vec2(83.0, 12.0)) - 0.5;
  float paperTexture = fineSand * 0.68 + fineSandOffset * 0.32;

  float sampleFrame = floor(u_time * 12.0);
  vec2 sampleCell = floor(cssPixel / 1.12);
  float changingSeed = hash(sampleCell + sampleFrame * vec2(19.0, 37.0));
  float lightFleck = smoothstep(0.991, 1.0, changingSeed);
  float darkFleck = smoothstep(0.0, 0.009, changingSeed);
  float fleckShape = 0.72 + hash(sampleCell + vec2(41.0, 9.0)) * 0.28;
  float discontinuousNoise = (lightFleck - darkFleck) * fleckShape;

  float signedTexture = paperTexture + discontinuousNoise * 0.18;
  float paperAlpha = 0.035 + abs(paperTexture) * 0.18;
  float fleckAlpha = abs(discontinuousNoise) * 0.065;
  float middleWeight = 0.56 + 0.44 * exp(-pow((uv.y - 0.52) / 0.28, 2.0));
  float alpha = clamp((paperAlpha + fleckAlpha) * middleWeight, 0.0, 0.13);

  vec3 warmPaper = vec3(0.76, 0.745, 0.69);
  vec3 warmInk = vec3(0.015, 0.014, 0.012);
  vec3 tone = signedTexture >= 0.0 ? warmPaper : warmInk;

  gl_FragColor = vec4(tone, alpha);
}
`;

export function SitePaperGrain({ ready }: { ready: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const startBurstRef = useRef<(durationMs?: number) => void>(() => {});

  useEffect(() => {
    if (!ready) {
      return;
    }

    const firstBurstTimer = window.setTimeout(() => {
      startBurstRef.current(1_300);
    }, FIRST_BURST_DELAY_MS);

    return () => {
      window.clearTimeout(firstBurstTimer);
    };
  }, [ready]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("webgl", {
      alpha: true,
      antialias: false,
      premultipliedAlpha: false,
      powerPreference: "low-power",
    });
    if (!canvas || !context) {
      return;
    }

    const program = createProgram(context, vertexShaderSource, fragmentShaderSource);
    const positionLocation = context.getAttribLocation(program, "a_position");
    const resolutionLocation = context.getUniformLocation(program, "u_resolution");
    const timeLocation = context.getUniformLocation(program, "u_time");
    const pixelRatioLocation = context.getUniformLocation(program, "u_pixel_ratio");
    const positionBuffer = context.createBuffer();
    if (!positionBuffer) {
      context.deleteProgram(program);
      return;
    }

    context.bindBuffer(context.ARRAY_BUFFER, positionBuffer);
    context.bufferData(
      context.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      context.STATIC_DRAW,
    );
    context.useProgram(program);
    context.enableVertexAttribArray(positionLocation);
    context.vertexAttribPointer(positionLocation, 2, context.FLOAT, false, 0, 0);

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frameId = 0;
    let burstTimer = 0;
    let idleTimer = 0;
    let lastFrameAt = -TARGET_FRAME_MS;

    const resize = () => {
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.35);
      const nextWidth = Math.max(1, Math.round(window.innerWidth * pixelRatio));
      const nextHeight = Math.max(1, Math.round(window.innerHeight * pixelRatio));
      if (canvas.width === nextWidth && canvas.height === nextHeight) {
        return;
      }

      canvas.width = nextWidth;
      canvas.height = nextHeight;
      context.viewport(0, 0, nextWidth, nextHeight);
      context.uniform2f(resolutionLocation, nextWidth, nextHeight);
      context.uniform1f(pixelRatioLocation, pixelRatio);
    };

    const draw = (time: number) => {
      resize();
      context.uniform1f(timeLocation, time / 1000);
      context.drawArrays(context.TRIANGLE_STRIP, 0, 4);
    };

    const animate = (time: number) => {
      frameId = window.requestAnimationFrame(animate);
      if (time - lastFrameAt < TARGET_FRAME_MS) {
        return;
      }

      lastFrameAt = time;
      draw(time);
    };

    const stopBurst = () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(burstTimer);
      canvas.dataset.active = "false";
    };

    const scheduleIdleBurst = () => {
      window.clearTimeout(idleTimer);
      if (reducedMotion.matches) {
        return;
      }

      const delay = IDLE_BURST_MIN_MS + Math.random() * IDLE_BURST_SPREAD_MS;
      idleTimer = window.setTimeout(() => {
        const duration = BURST_MIN_MS + Math.random() * BURST_SPREAD_MS;
        startBurstRef.current(duration);
      }, delay);
    };

    const startBurst = (durationMs = BURST_MIN_MS) => {
      if (reducedMotion.matches || document.hidden) {
        scheduleIdleBurst();
        return;
      }

      stopBurst();
      window.clearTimeout(idleTimer);
      lastFrameAt = -TARGET_FRAME_MS;
      canvas.style.setProperty("--site-signal-duration", `${Math.round(durationMs)}ms`);
      void canvas.offsetWidth;
      canvas.dataset.active = "true";
      draw(performance.now());
      frameId = window.requestAnimationFrame(animate);
      burstTimer = window.setTimeout(() => {
        stopBurst();
        scheduleIdleBurst();
      }, durationMs);
    };

    const handleMotionPreference = () => {
      stopBurst();
      scheduleIdleBurst();
    };

    startBurstRef.current = startBurst;
    canvas.dataset.active = "false";
    window.addEventListener("resize", resize);
    reducedMotion.addEventListener("change", handleMotionPreference);

    return () => {
      startBurstRef.current = () => {};
      stopBurst();
      window.clearTimeout(idleTimer);
      window.removeEventListener("resize", resize);
      reducedMotion.removeEventListener("change", handleMotionPreference);
      context.deleteBuffer(positionBuffer);
      context.deleteProgram(program);
    };
  }, []);

  return <canvas ref={canvasRef} className="site-paper-grain" aria-hidden="true" />;
}

function createProgram(context: WebGLRenderingContext, vertexSource: string, fragmentSource: string) {
  const vertexShader = createShader(context, context.VERTEX_SHADER, vertexSource);
  const fragmentShader = createShader(context, context.FRAGMENT_SHADER, fragmentSource);
  const program = context.createProgram();
  if (!program) {
    throw new Error("Unable to create the site paper-grain shader program.");
  }

  context.attachShader(program, vertexShader);
  context.attachShader(program, fragmentShader);
  context.linkProgram(program);
  context.deleteShader(vertexShader);
  context.deleteShader(fragmentShader);

  if (!context.getProgramParameter(program, context.LINK_STATUS)) {
    const details = context.getProgramInfoLog(program) ?? "Unknown shader link error.";
    context.deleteProgram(program);
    throw new Error(details);
  }

  return program;
}

function createShader(context: WebGLRenderingContext, type: number, source: string) {
  const shader = context.createShader(type);
  if (!shader) {
    throw new Error("Unable to create the site paper-grain shader.");
  }

  context.shaderSource(shader, source);
  context.compileShader(shader);
  if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) {
    const details = context.getShaderInfoLog(shader) ?? "Unknown shader compilation error.";
    context.deleteShader(shader);
    throw new Error(details);
  }

  return shader;
}
