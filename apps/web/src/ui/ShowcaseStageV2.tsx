import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type MutableRefObject,
} from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { createShowcaseScreenTexture } from "./showcaseScreenTexture";
import { squircleRectPoints } from "./squircleGeometry";

const SCREEN_ASPECT = 2 / 3;
const DEFAULT_ROTATION = { x: -0.08, y: -0.22 };
const BODY_CORNER = {
  radius: 0.15,
  exponentX: 4.2,
  exponentY: 3.8,
};
const GLASS_CORNER = {
  exponent: 3.5,
};
const DETAIL_CORNER = {
  radius: 0.014,
  exponent: 3.2,
};
const IDLE_ROTATION_POINTS: ViewRotation[] = [
  { x: -0.12, y: -0.32 },
  { x: -0.02, y: 0.26 },
  { x: -0.18, y: -0.62 },
  { x: 0.04, y: 0.46 },
  { x: -0.1, y: 0.04 },
  { x: -0.08, y: Math.PI - 0.18 },
  { x: -0.12, y: -Math.PI + 0.2 },
];
const CELEBRATION_DURATION_MS = 3600;
const CELEBRATION_TURNS = Math.PI * 4;
const CELEBRATION_EVENT = "jiko:celebrate";
const COMBO_LIFT_PER_CLICK = 0.2;
const COMBO_MAX_LIFT = 2.0;
const COMBO_DESCEND_DELAY = 600;
const DESCEND_DURATION_MS = 420;
const HOVER_PAUSE_MS = 400; // pause at top before descending

type ViewRotation = { x: number; y: number };
type DragState = {
  id: number;
  startX: number;
  startY: number;
  base: ViewRotation;
};
type CelebrationSpin = {
  phase: "combo" | "hover" | "descend";
  start: number;
  fromX: number;
  fromY: number;
  fromPositionY: number;
  baseY: number;
  targetLift: number;
  comboCount: number;
  direction: -1 | 1;
  bobAmplitude: number;
  bobPhase: number;
  pop: number;
};

export function ShowcaseStage({
  surface = "standalone",
  onReady,
}: {
  surface?: "standalone" | "embedded";
  onReady?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HardwareScene>();
  const rotationRef = useRef<ViewRotation>({ ...DEFAULT_ROTATION });
  const dragRef = useRef<DragState>();
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const scene = createHardwareScene(host, (rotation) => {
      rotationRef.current = rotation;
    }, () => {
      window.requestAnimationFrame(() => {
        onReadyRef.current?.();
      });
    });
    sceneRef.current = scene;
    rotationRef.current = scene.getRotation();

    return () => {
      sceneRef.current = undefined;
      scene.dispose();
    };
  }, []);

  useEffect(() => {
    const finishPointer = (event: PointerEvent) => {
      finishDrag(dragRef, sceneRef, event.pointerId);
    };
    const finishAnyPointer = () => {
      finishDrag(dragRef, sceneRef);
    };
    const celebrate = () => {
      sceneRef.current?.celebrateSpin();
    };

    window.addEventListener(CELEBRATION_EVENT, celebrate);
    window.addEventListener("pointerup", finishPointer);
    window.addEventListener("pointercancel", finishPointer);
    window.addEventListener("mouseup", finishAnyPointer);
    window.addEventListener("touchend", finishAnyPointer);
    window.addEventListener("blur", finishAnyPointer);

    return () => {
      window.removeEventListener(CELEBRATION_EVENT, celebrate);
      window.removeEventListener("pointerup", finishPointer);
      window.removeEventListener("pointercancel", finishPointer);
      window.removeEventListener("mouseup", finishAnyPointer);
      window.removeEventListener("touchend", finishAnyPointer);
      window.removeEventListener("blur", finishAnyPointer);
    };
  }, []);

  return (
    <main
      className="showcase-stage"
      data-surface={surface}
      aria-label="jiko hardware material showcase"
      onPointerDown={(event) => beginDrag(event, dragRef, rotationRef, sceneRef)}
      onPointerMove={(event) => updateDrag(event, dragRef, rotationRef, sceneRef)}
      onPointerUp={(event) => endDrag(event, dragRef, sceneRef)}
      onPointerCancel={(event) => endDrag(event, dragRef, sceneRef)}
      onLostPointerCapture={(event) => endDrag(event, dragRef, sceneRef)}
    >
      <div className="showcase-renderer" ref={hostRef} aria-hidden="true" />
    </main>
  );
}

function createHardwareScene(
  host: HTMLDivElement,
  onRotationFrame: (rotation: ViewRotation) => void,
  onFirstFrame?: () => void,
) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.5;
  host.append(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  camera.position.set(0, 0.04, 9.2);

  const environmentScene = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(environmentScene).texture;
  scene.environment = environment;

  const screenTexture = createShowcaseScreenTexture();
  const hardware = buildHardware(screenTexture.texture);
  hardware.rotation.x = DEFAULT_ROTATION.x;
  hardware.rotation.y = DEFAULT_ROTATION.y;
  scene.add(hardware);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x020202, 0.16));

  const key = new THREE.DirectionalLight(0xffffff, 1.32);
  key.position.set(-3.6, 5.2, 5.4);
  scene.add(key);

  const rim = new THREE.DirectionalLight(0xd9f1ff, 0.94);
  rim.position.set(5.5, 1.4, 3.2);
  scene.add(rim);

  const coolFloor = new THREE.DirectionalLight(0x8fa8c6, 0.34);
  coolFloor.position.set(-2.2, -3.8, 4.4);
  scene.add(coolFloor);

  const coolGlance = new THREE.DirectionalLight(0xaeb8c8, 0.44);
  coolGlance.position.set(-4.6, 2.2, 3.8);
  scene.add(coolGlance);

  const resize = () => {
    const rect = host.getBoundingClientRect();
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / Math.max(1, rect.height);
    camera.position.z = resolveCameraDistance(camera.aspect, camera.fov);
    camera.updateProjectionMatrix();
  };

  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  let frameId = 0;
  let dragging = false;
  let readyNotified = false;
  let lastRotation = { x: Number.NaN, y: Number.NaN };
  let idleTarget = nextIdleRotation();
  let nextIdleTurnAt = performance.now() + 1800;
  let idlePausedUntil = 0;
  let celebrationSpin: CelebrationSpin | undefined;
  let descendTimer: number | undefined;

  const render = (time: number) => {
    screenTexture.update(time);

    if (celebrationSpin && !dragging) {
      if (celebrationSpin.phase === "combo") {
        const progress = clamp((time - celebrationSpin.start) / CELEBRATION_DURATION_MS, 0, 1);
        const eased = easeInOutBezier(progress);
        const envelope = Math.sin(progress * Math.PI);
        const popProgress = clamp((time - celebrationSpin.start) / 340, 0, 1);
        const pop = Math.sin(popProgress * Math.PI) * celebrationSpin.pop;
        const bob = Math.sin(progress * Math.PI * 6 + celebrationSpin.bobPhase) *
          celebrationSpin.bobAmplitude *
          envelope;
        const lift = envelope;

        // Smoothly rise toward targetLift from wherever we started
        const riseProgress = clamp((time - celebrationSpin.start) / 400, 0, 1);
        const riseEased = 1 - Math.pow(1 - riseProgress, 3);
        const currentLift = celebrationSpin.fromPositionY + (celebrationSpin.targetLift - celebrationSpin.fromPositionY) * riseEased;

        hardware.rotation.x = celebrationSpin.fromX - lift * 0.12 + pop * 0.24;
        hardware.rotation.y = celebrationSpin.fromY +
          celebrationSpin.direction * CELEBRATION_TURNS * eased;
        hardware.position.y = currentLift + bob + pop;

        if (progress >= 1) {
          const normalizedY = normalizeRotationY(hardware.rotation.y);
          hardware.rotation.y = normalizedY;
          hardware.position.y = celebrationSpin.baseY;
          idleTarget = nextIdleRotation({ x: hardware.rotation.x, y: normalizedY });
          nextIdleTurnAt = time + randomBetween(1200, 2200);
          idlePausedUntil = 0;
          celebrationSpin = undefined;
        }
      } else if (celebrationSpin.phase === "hover") {
        // Hover pause — slight tension wobble at the top before falling
        const progress = clamp((time - celebrationSpin.start) / HOVER_PAUSE_MS, 0, 1);
        const wobble = Math.sin(progress * Math.PI * 4) * 0.015 * (1 - progress);
        hardware.position.y = celebrationSpin.fromPositionY + wobble;
        // Slight rotation tension
        hardware.rotation.x += Math.sin(progress * Math.PI * 3) * 0.003;

        if (progress >= 1) {
          celebrationSpin = {
            ...celebrationSpin,
            phase: "descend",
            start: performance.now(),
            fromPositionY: celebrationSpin.fromPositionY,
          };
        }
      } else {
        // descend phase — "天神下凡"
        const bounceDuration = 800;
        const totalDuration = DESCEND_DURATION_MS + bounceDuration;
        const elapsed = time - celebrationSpin.start;
        const fallProgress = clamp(elapsed / DESCEND_DURATION_MS, 0, 1);
        // Heavy gravity: nearly free-fall
        const fallEased = Math.pow(fallProgress, 3.2);
        // Bounce: ball-bounce style (always upward, never below ground)
        const bounceElapsed = elapsed - DESCEND_DURATION_MS;
        const bounceT = clamp(bounceElapsed / bounceDuration, 0, 1);
        const bounce = bounceElapsed > 0
          ? Math.abs(Math.sin(bounceT * Math.PI * 3)) * 0.25 * Math.pow(1 - bounceT, 2)
          : 0;
        const sway = Math.sin(fallProgress * Math.PI * 2) * 0.02 * (1 - fallProgress);

        const height = celebrationSpin.fromPositionY * (1 - fallEased);
        hardware.position.y = celebrationSpin.baseY + Math.max(0, height) + bounce;
        hardware.rotation.y += sway * 0.016;

        const totalProgress = clamp(elapsed / totalDuration, 0, 1);
        if (totalProgress >= 1) {
          hardware.position.y = celebrationSpin.baseY;
          const normalizedY = normalizeRotationY(hardware.rotation.y);
          hardware.rotation.y = normalizedY;
          idleTarget = nextIdleRotation({ x: hardware.rotation.x, y: normalizedY });
          nextIdleTurnAt = time + randomBetween(1200, 2200);
          idlePausedUntil = 0;
          celebrationSpin = undefined;
        }
      }
    } else if (!dragging) {
      if (time >= nextIdleTurnAt) {
        if (time < idlePausedUntil) {
          nextIdleTurnAt = idlePausedUntil;
        } else {
          idleTarget = nextIdleRotation(idleTarget);
          nextIdleTurnAt = time + randomBetween(3200, 6200);
          idlePausedUntil = Math.random() < 0.34 ? time + randomBetween(700, 1700) : 0;
        }
      }

      const ease = 0.0055 + 0.0035 * Math.sin(time * 0.0011) ** 2;
      hardware.rotation.x = THREE.MathUtils.lerp(hardware.rotation.x, idleTarget.x, ease);
      hardware.rotation.y = THREE.MathUtils.lerp(hardware.rotation.y, idleTarget.y, ease * 0.86);
    }

    if (
      Math.abs(hardware.rotation.x - lastRotation.x) > 0.0002 ||
      Math.abs(hardware.rotation.y - lastRotation.y) > 0.0002
    ) {
      lastRotation = { x: hardware.rotation.x, y: hardware.rotation.y };
      onRotationFrame(lastRotation);
    }

    renderer.render(scene, camera);
    if (!readyNotified) {
      readyNotified = true;
      onFirstFrame?.();
    }
    frameId = window.requestAnimationFrame(render);
  };
  frameId = window.requestAnimationFrame(render);

  return {
    setRotation(rotation: ViewRotation) {
      hardware.rotation.x = rotation.x;
      hardware.rotation.y = rotation.y;
    },
    getRotation() {
      return { x: hardware.rotation.x, y: hardware.rotation.y };
    },
    setDragging(value: boolean) {
      dragging = value;
      if (value) {
        celebrationSpin = undefined;
      }
      if (!value) {
        idleTarget = nextIdleRotation({ x: hardware.rotation.x, y: hardware.rotation.y });
        nextIdleTurnAt = performance.now() + randomBetween(900, 1900);
        idlePausedUntil = 0;
      }
    },
    celebrateSpin() {
      const now = performance.now();

      if (celebrationSpin && (celebrationSpin.phase === "combo" || celebrationSpin.phase === "hover")) {
        // Combo: increment lift with diminishing returns (only lift after 3 clicks)
        if (celebrationSpin.phase === "hover") {
          celebrationSpin.phase = "combo";
        }
        celebrationSpin.comboCount++;
        if (celebrationSpin.comboCount > 2) {
          const diminish = 1 / (1 + (celebrationSpin.comboCount - 2) * 0.15);
          celebrationSpin.targetLift = Math.min(
            celebrationSpin.targetLift + COMBO_LIFT_PER_CLICK * diminish,
            COMBO_MAX_LIFT,
          );
        }
        celebrationSpin.start = now;
        celebrationSpin.fromX = hardware.rotation.x;
        celebrationSpin.fromY = hardware.rotation.y;
        celebrationSpin.fromPositionY = hardware.position.y;
        celebrationSpin.direction = Math.random() < 0.5 ? -1 : 1;
        celebrationSpin.pop = randomBetween(0.1, 0.16);
        celebrationSpin.bobPhase = randomBetween(0, Math.PI * 2);
      } else {
        // New celebration
        celebrationSpin = {
          phase: "combo",
          start: now,
          fromX: hardware.rotation.x,
          fromY: hardware.rotation.y,
          fromPositionY: hardware.position.y,
          baseY: 0,
          targetLift: 0,
          comboCount: 1,
          direction: Math.random() < 0.5 ? -1 : 1,
          bobAmplitude: randomBetween(0.12, 0.19),
          bobPhase: randomBetween(0, Math.PI * 2),
          pop: randomBetween(0.1, 0.16),
        };
      }

      dragging = false;

      // Reset descend timer
      if (descendTimer) clearTimeout(descendTimer);
      descendTimer = window.setTimeout(() => {
        if (celebrationSpin && celebrationSpin.phase === "combo" && celebrationSpin.comboCount > 2) {
          // Snap to stable height, enter hover pause before descend
          hardware.position.y = celebrationSpin.targetLift;
          celebrationSpin = {
            ...celebrationSpin,
            phase: "hover",
            start: performance.now(),
            fromPositionY: celebrationSpin.targetLift,
          };
        }
      }, COMBO_DESCEND_DELAY);

      nextIdleTurnAt = now + CELEBRATION_DURATION_MS + 1200;
      idlePausedUntil = 0;
    },
    dispose() {
      if (descendTimer) clearTimeout(descendTimer);
      window.cancelAnimationFrame(frameId);
      observer.disconnect();
      scene.remove(hardware);
      disposeObject(hardware);
      screenTexture.dispose();
      environment.dispose();
      environmentScene.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

type HardwareScene = ReturnType<typeof createHardwareScene>;

function resolveCameraDistance(aspect: number, verticalFov: number) {
  const verticalRadians = THREE.MathUtils.degToRad(verticalFov);
  const horizontalFitDistance = 3.36 / (2 * Math.tan(verticalRadians / 2) * aspect);
  return Math.max(8.8, horizontalFitDistance);
}

function createWoodTexture(width = 1024, height = 1024) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.Texture();

  // Walnut-like base: warm medium brown
  const base = ctx.createLinearGradient(0, 0, 0, height);
  base.addColorStop(0, "#5c3a2a");
  base.addColorStop(0.5, "#6b4130");
  base.addColorStop(1, "#5c3a2a");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);

  // Grain lines: darker brown, mostly vertical with slight waviness
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = "#3d2418";
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 220; i++) {
    const x = Math.random() * width;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    let cx = x;
    for (let y = 0; y < height; y += 24) {
      cx += (Math.random() - 0.5) * 2.2;
      ctx.lineTo(cx, y);
    }
    ctx.stroke();
  }

  // Lighter streaks for wood figure
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = "#8a5a42";
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 80; i++) {
    const x = Math.random() * width;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    let cx = x;
    for (let y = 0; y < height; y += 32) {
      cx += (Math.random() - 0.5) * 3;
      ctx.lineTo(cx, y);
    }
    ctx.stroke();
  }

  // Fine noise
  ctx.globalAlpha = 0.08;
  for (let i = 0; i < 6000; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    ctx.fillStyle = Math.random() > 0.5 ? "#2a1812" : "#a06b52";
    ctx.fillRect(x, y, 1, 1);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function buildHardware(screenTexture: THREE.Texture) {
  const group = new THREE.Group();
  const bodyW = 1.82;
  const bodyH = bodyW / SCREEN_ASPECT;
  const bodyDepth = 0.15;
  const bodyRadius = BODY_CORNER.radius;

  const woodTexture = createWoodTexture();
  const shellMaterial = new THREE.MeshPhysicalMaterial({
    map: woodTexture,
    color: 0xffffff,
    metalness: 0.05,
    roughness: 0.42,
    clearcoat: 0.18,
    clearcoatRoughness: 0.35,
    envMapIntensity: 0.08,
    reflectivity: 0.1,
    polygonOffset: true,
    polygonOffsetFactor: 4,
    polygonOffsetUnits: 4,
  });

  const body = new THREE.Mesh(
    new THREE.ExtrudeGeometry(
      squircleRect(bodyW, bodyH, bodyRadius, BODY_CORNER.exponentX, BODY_CORNER.exponentY),
      {
        depth: bodyDepth,
        bevelEnabled: true,
        bevelSize: 0.026,
        bevelThickness: 0.026,
        bevelSegments: 18,
        curveSegments: 34,
      },
    ).center(),
    shellMaterial,
  );
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const frontFace = new THREE.Mesh(
    new THREE.ShapeGeometry(
      squircleRect(
        bodyW * 0.998,
        bodyH * 0.998,
        bodyRadius * 0.98,
        BODY_CORNER.exponentX,
        BODY_CORNER.exponentY,
      ),
    ),
    new THREE.MeshPhysicalMaterial({
      map: woodTexture,
      color: 0xffffff,
      metalness: 0.04,
      roughness: 0.4,
      clearcoat: 0.16,
      clearcoatRoughness: 0.38,
      envMapIntensity: 0.06,
    }),
  );
  frontFace.position.z = bodyDepth * 0.5 + 0.004;
  group.add(frontFace);

  const backPlate = new THREE.Mesh(
    new THREE.ShapeGeometry(
      squircleRect(
        bodyW * 0.88,
        bodyH * 0.88,
        bodyRadius * 0.62,
        BODY_CORNER.exponentX,
        BODY_CORNER.exponentY,
      ),
    ),
    new THREE.MeshPhysicalMaterial({
      map: woodTexture,
      color: 0xffffff,
      metalness: 0.04,
      roughness: 0.38,
      clearcoat: 0.16,
      clearcoatRoughness: 0.38,
      envMapIntensity: 0.06,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: 4,
      polygonOffsetUnits: 4,
    }),
  );
  backPlate.position.z = -bodyDepth * 0.515;
  backPlate.rotation.y = Math.PI;
  group.add(backPlate);

  const screenW = bodyW * 0.99;
  const screenH = screenW / SCREEN_ASPECT;
  const screenLipW = bodyW * 0.988;
  const screenLipH = bodyH * 0.988;

  const screenPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(screenW, screenH),
    new THREE.MeshBasicMaterial({
      map: screenTexture,
      transparent: true,
      alphaTest: 0.02,
      toneMapped: false,
    }),
  );
  screenPlane.position.z = bodyDepth * 0.5 + 0.052;
  group.add(screenPlane);

  const screenLip = new THREE.Mesh(
    new THREE.ShapeGeometry(
      squircleRect(
        screenLipW,
        screenLipH,
        bodyRadius * 0.92,
        GLASS_CORNER.exponent,
        GLASS_CORNER.exponent,
      ),
    ),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.012,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  screenLip.position.z = bodyDepth * 0.5 + 0.057;
  group.add(screenLip);

  const sideButton = buildSideButton(bodyW, bodyH, bodyDepth);
  group.add(sideButton);

  const functionalDetails = buildFunctionalDetails(bodyW, bodyH, bodyDepth);
  group.add(functionalDetails);

  group.scale.setScalar(0.98);
  return group;
}

function nextIdleRotation(previous?: ViewRotation) {
  let next = IDLE_ROTATION_POINTS[Math.floor(Math.random() * IDLE_ROTATION_POINTS.length)];

  if (previous) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const candidate = IDLE_ROTATION_POINTS[Math.floor(Math.random() * IDLE_ROTATION_POINTS.length)];
      const distance = Math.abs(candidate.x - previous.x) + Math.abs(candidate.y - previous.y);
      if (distance > 0.2) {
        next = candidate;
        break;
      }
    }
  }

  return {
    x: next.x + randomBetween(-0.035, 0.035),
    y: next.y + randomBetween(-0.07, 0.07),
  };
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function easeInOutBezier(value: number) {
  return cubicBezierY(value, 0, 0.08, 0.92, 1);
}

function cubicBezierY(t: number, y0: number, y1: number, y2: number, y3: number) {
  const u = 1 - t;
  return u ** 3 * y0 + 3 * u ** 2 * t * y1 + 3 * u * t ** 2 * y2 + t ** 3 * y3;
}

function normalizeRotationY(value: number) {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

function buildSideButton(bodyW: number, bodyH: number, bodyDepth: number) {
  const side = new THREE.Group();
  const buttonMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xc8c8d0,
    metalness: 0.92,
    roughness: 0.18,
    clearcoat: 0.35,
    clearcoatRoughness: 0.15,
    envMapIntensity: 0.6,
    reflectivity: 0.5,
  });

  const rail = new THREE.Mesh(
    new THREE.ExtrudeGeometry(roundedRect(0.12, bodyH * 0.46, 0.045), {
      depth: 0.16,
      bevelEnabled: true,
      bevelSize: 0.018,
      bevelThickness: 0.018,
      bevelSegments: 12,
      curveSegments: 16,
    }).center(),
    buttonMaterial,
  );
  rail.rotation.y = Math.PI * 0.5;
  rail.position.set(bodyW * 0.575, 0.18, bodyDepth * 0.1);
  side.add(rail);

  const glint = new THREE.Mesh(
    new THREE.PlaneGeometry(0.018, bodyH * 0.34),
    new THREE.MeshBasicMaterial({
      color: 0x9fb0c4,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  glint.position.set(bodyW * 0.62, 0.22, bodyDepth * 0.2);
  side.add(glint);

  return side;
}

function buildFunctionalDetails(bodyW: number, bodyH: number, bodyDepth: number) {
  const details = new THREE.Group();

  const screwMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xb8bcc4,
    metalness: 0.88,
    roughness: 0.22,
    clearcoat: 0.28,
    clearcoatRoughness: 0.2,
    envMapIntensity: 0.5,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const screwSlotMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  details.add(buildUsbCPort(bodyW, bodyH, bodyDepth));
  details.add(buildMicAperture(bodyW, bodyH, bodyDepth));
  details.add(buildThermalVent(bodyW, bodyH, bodyDepth));

  const screwPositions = [
    [-bodyW * 0.39, bodyH * 0.395],
    [bodyW * 0.39, -bodyH * 0.395],
  ] as const;

  screwPositions.forEach(([x, y]) => {
    const screw = new THREE.Mesh(new THREE.CircleGeometry(0.026, 28), screwMaterial);
    screw.position.set(x, y, -bodyDepth * 0.52);
    syncRearOverlayDepth(screw, screwMaterial);
    details.add(screw);

    const slot = new THREE.Mesh(new THREE.PlaneGeometry(0.032, 0.005), screwSlotMaterial);
    slot.position.set(x, y, -bodyDepth * 0.525);
    syncRearOverlayDepth(slot, screwSlotMaterial);
    details.add(slot);
  });

  return details;
}

function syncRearOverlayDepth(mesh: THREE.Mesh, material: THREE.Material) {
  const rearNormal = new THREE.Vector3();
  const meshPosition = new THREE.Vector3();
  const cameraPosition = new THREE.Vector3();
  const toCamera = new THREE.Vector3();

  mesh.renderOrder = 4;
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    rearNormal.set(0, 0, -1).transformDirection(mesh.matrixWorld);
    mesh.getWorldPosition(meshPosition);
    camera.getWorldPosition(cameraPosition);
    toCamera.copy(cameraPosition).sub(meshPosition).normalize();
    material.depthTest = rearNormal.dot(toCamera) <= 0.18;
  };
}

function buildUsbCPort(bodyW: number, bodyH: number, bodyDepth: number) {
  const port = new THREE.Group();
  const bottomY = -bodyH * 0.5 - 0.004;
  const portZ = 0;
  const frontChinY = -bodyH * 0.5 + 0.034;
  const frontZ = bodyDepth * 0.505 + 0.007;

  const recessMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x242a31,
    metalness: 0.42,
    roughness: 0.48,
    clearcoat: 0.18,
    clearcoatRoughness: 0.46,
    envMapIntensity: 0.28,
    side: THREE.DoubleSide,
  });
  const portInteriorMaterial = new THREE.MeshBasicMaterial({
    color: 0x040608,
    transparent: true,
    opacity: 0.98,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const portLipMaterial = new THREE.MeshBasicMaterial({
    color: 0xd8e2ee,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const frontRimMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xc0c5cc,
    metalness: 0.88,
    roughness: 0.2,
    clearcoat: 0.3,
    clearcoatRoughness: 0.18,
    envMapIntensity: 0.55,
    side: THREE.DoubleSide,
  });

  const recess = new THREE.Mesh(
    new THREE.ExtrudeGeometry(
      squircleRect(
        0.31,
        0.108,
        DETAIL_CORNER.radius * 1.6,
        DETAIL_CORNER.exponent,
        DETAIL_CORNER.exponent,
      ),
      { depth: 0.008, bevelEnabled: false },
    ),
    recessMaterial,
  );
  recess.rotation.x = Math.PI * 0.5;
  recess.position.set(0, bottomY, portZ);
  port.add(recess);

  const usbCShape = new THREE.Shape();
  const usbW = 0.19;
  const usbH = 0.052;
  const usbR = usbH / 2;
  usbCShape.moveTo(-usbW / 2 + usbR, -usbH / 2);
  usbCShape.lineTo(usbW / 2 - usbR, -usbH / 2);
  usbCShape.absarc(usbW / 2 - usbR, 0, usbR, -Math.PI / 2, Math.PI / 2, false);
  usbCShape.lineTo(-usbW / 2 + usbR, usbH / 2);
  usbCShape.absarc(-usbW / 2 + usbR, 0, usbR, Math.PI / 2, -Math.PI / 2, false);

  const innerMouth = new THREE.Mesh(
    new THREE.ExtrudeGeometry(usbCShape, { depth: 0.006, bevelEnabled: false }),
    portInteriorMaterial,
  );
  innerMouth.rotation.copy(recess.rotation);
  innerMouth.position.set(0, bottomY - 0.002, portZ);
  port.add(innerMouth);

  const tongueW = 0.12;
  const tongueH = 0.015;
  const tongueR = tongueH / 2;
  const tongueShape = new THREE.Shape();
  tongueShape.moveTo(-tongueW / 2 + tongueR, -tongueH / 2);
  tongueShape.lineTo(tongueW / 2 - tongueR, -tongueH / 2);
  tongueShape.absarc(tongueW / 2 - tongueR, 0, tongueR, -Math.PI / 2, Math.PI / 2, false);
  tongueShape.lineTo(-tongueW / 2 + tongueR, tongueH / 2);
  tongueShape.absarc(-tongueW / 2 + tongueR, 0, tongueR, Math.PI / 2, -Math.PI / 2, false);
  const bottomTongue = new THREE.Mesh(
    new THREE.ExtrudeGeometry(tongueShape, { depth: 0.004, bevelEnabled: false }),
    new THREE.MeshPhysicalMaterial({
      color: 0x0a0c0f,
      metalness: 0.28,
      roughness: 0.62,
      envMapIntensity: 0.1,
      side: THREE.DoubleSide,
    }),
  );
  bottomTongue.rotation.copy(recess.rotation);
  bottomTongue.position.set(0, bottomY - 0.003, portZ);
  port.add(bottomTongue);

  const lip = new THREE.Mesh(
    new THREE.ExtrudeGeometry(
      squircleRect(
        0.23,
        0.078,
        DETAIL_CORNER.radius * 1.2,
        DETAIL_CORNER.exponent,
        DETAIL_CORNER.exponent,
      ),
      { depth: 0.007, bevelEnabled: false },
    ),
    portLipMaterial,
  );
  lip.rotation.copy(recess.rotation);
  lip.position.set(0, bottomY - 0.003, portZ);
  port.add(lip);

  const frontRim = new THREE.Mesh(
    new THREE.ShapeGeometry(
      squircleRect(
        0.36,
        0.052,
        DETAIL_CORNER.radius * 1.35,
        DETAIL_CORNER.exponent,
        DETAIL_CORNER.exponent,
      ),
    ),
    frontRimMaterial,
  );
  frontRim.position.set(0, frontChinY, frontZ);
  port.add(frontRim);

  const frontMouthW = 0.24;
  const frontMouthH = 0.028;
  const frontMouthR = frontMouthH / 2;
  const frontMouthShape = new THREE.Shape();
  frontMouthShape.moveTo(-frontMouthW / 2 + frontMouthR, -frontMouthH / 2);
  frontMouthShape.lineTo(frontMouthW / 2 - frontMouthR, -frontMouthH / 2);
  frontMouthShape.absarc(frontMouthW / 2 - frontMouthR, 0, frontMouthR, -Math.PI / 2, Math.PI / 2, false);
  frontMouthShape.lineTo(-frontMouthW / 2 + frontMouthR, frontMouthH / 2);
  frontMouthShape.absarc(-frontMouthW / 2 + frontMouthR, 0, frontMouthR, Math.PI / 2, -Math.PI / 2, false);
  const frontMouth = new THREE.Mesh(
    new THREE.ExtrudeGeometry(frontMouthShape, { depth: 0.003, bevelEnabled: false }),
    portInteriorMaterial,
  );
  frontMouth.rotation.y = Math.PI;
  frontMouth.position.set(0, frontChinY - 0.001, frontZ + 0.0015);
  port.add(frontMouth);

  const ftW = 0.1;
  const ftH = 0.012;
  const ftR = ftH / 2;
  const ftShape = new THREE.Shape();
  ftShape.moveTo(-ftW / 2 + ftR, -ftH / 2);
  ftShape.lineTo(ftW / 2 - ftR, -ftH / 2);
  ftShape.absarc(ftW / 2 - ftR, 0, ftR, -Math.PI / 2, Math.PI / 2, false);
  ftShape.lineTo(-ftW / 2 + ftR, ftH / 2);
  ftShape.absarc(-ftW / 2 + ftR, 0, ftR, Math.PI / 2, -Math.PI / 2, false);
  const frontTongue = new THREE.Mesh(
    new THREE.ShapeGeometry(ftShape),
    new THREE.MeshBasicMaterial({
      color: 0x050607,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  frontTongue.position.set(0, frontChinY - 0.002, frontZ + 0.0025);
  port.add(frontTongue);

  const frontHighlight = new THREE.Mesh(
    new THREE.ShapeGeometry(roundedRect(0.3, 0.006, 0.002)),
    new THREE.MeshBasicMaterial({
      color: 0xe8f0f8,
      transparent: true,
      opacity: 0.06,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
  );
  frontHighlight.position.set(0, frontChinY + 0.018, frontZ + 0.002);
  port.add(frontHighlight);

  port.children.forEach((child) => {
    child.renderOrder = 6;
  });

  return port;
}

const RECHAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -91 971 925">
<g transform="scale(1,-1) translate(0,-834)">
<g fill="#1a1a1a">
<path d="M205 603H83Q59 603 40 597L23 640Q46 636 73 636H205V714Q205 775 201 822Q344 813 344 793Q344 783 317 767V636H359Q393 688 397.0 692.0Q401 696 405 696Q414 696 459.0 659.5Q504 623 504.0 613.0Q504 603 484 603H317V497Q396 509 475 522Q481 522 481 520Q481 516 463.0 509.5Q445 503 398 482Q466 474 523 456Q531 512 534 565L470 554Q447 550 434 543L410 582Q432 583 458 587L537 600Q540 664 540.0 722.0Q540 780 538 834Q609 827 644.0 821.0Q679 815 685.0 811.0Q691 807 691.0 799.5Q691 792 675 785Q668 782 666 756L651 620L706 629Q733 682 748 682Q755 682 793.0 659.5Q831 637 850.0 622.5Q869 608 869.0 597.5Q869 587 828 578Q812 504 812.0 444.0Q812 384 827.5 347.5Q843 311 857 311Q882 311 910 410Q914 424 917.0 424.0Q920 424 920 406V383Q920 319 928.0 289.5Q936 260 953.5 240.5Q971 221 971.0 202.5Q971 184 954.0 170.5Q937 157 910 157Q863 157 812.5 184.0Q762 211 733.0 277.0Q704 343 704 473Q704 533 711 596L647 585Q634 470 612 414Q685 364 685 304Q685 273 665.5 250.5Q646 228 622.5 228.0Q599 228 588.5 240.0Q578 252 572.0 272.5Q566 293 558 312Q521 264 468.0 230.0Q415 196 354.5 177.0Q294 158 284 158Q280 158 280.0 161.0Q280 164 285 166Q370 202 428.0 259.5Q486 317 509 391Q464 442 387 477Q341 457 317 446V269Q317 233 310.5 212.0Q304 191 287.0 177.5Q270 164 236.0 155.0Q202 146 184.5 146.0Q167 146 166 169Q163 218 85 244Q75 248 75.0 251.0Q75 254 88 254Q143 255 167.0 259.0Q191 263 198.0 272.5Q205 282 205 302V395Q147 369 91 339Q81 334 76.5 334.0Q72 334 69.0 338.0Q66 342 54.5 374.5Q43 407 27 465Q89 469 205 482Z"/>
<path d="M135 160Q144 160 173.5 116.5Q203 73 203.0 25.5Q203 -22 171.5 -56.5Q140 -91 105.5 -91.0Q71 -91 54.5 -73.0Q38 -55 38.0 -26.0Q38 3 73 28Q138 75 138 122Q138 133 135.5 142.5Q133 152 133.0 156.0Q133 160 135 160Z"/>
<path d="M739 151Q775 151 829.5 132.5Q884 114 918.0 77.5Q952 41 952 1Q952 -80 875 -80Q852 -80 835.5 -60.5Q819 -41 815.0 4.0Q811 49 795.0 80.0Q779 111 740 139Q731 145 731.0 148.0Q731 151 739 151Z"/>
<path d="M509 144Q538 144 588.5 123.0Q639 102 671.0 63.0Q703 24 703.0 -11.0Q703 -46 675.5 -61.0Q648 -76 626.5 -76.0Q605 -76 591.5 -60.0Q578 -44 575 -15Q569 44 553.0 76.0Q537 108 504 127Q496 132 496.0 138.0Q496 144 509 144Z"/>
<path d="M298 130Q319 130 362.5 111.5Q406 93 432.5 61.5Q459 30 459.0 -7.5Q459 -45 434.5 -63.5Q410 -82 387.0 -82.0Q364 -82 348.0 -64.5Q332 -47 334.0 -26.5Q336 -6 336 9Q336 88 297 118Q290 123 290.0 126.5Q290 130 298 130Z"/>
</g>
</g>
</svg>`;

function buildThermalVent(bodyW: number, _bodyH: number, bodyDepth: number) {
  const vent = new THREE.Group();

  // Parse SVG to get character shapes
  const loader = new SVGLoader();
  const result = loader.parse(RECHAR_SVG);
  const rawShapes: THREE.Shape[] = [];
  for (const path of result.paths) {
    rawShapes.push(...SVGLoader.createShapes(path));
  }
  if (rawShapes.length === 0) return vent;

  // Compute bounding box across all shapes
  const box = new THREE.Box2();
  for (const s of rawShapes) {
    const pts = s.getPoints(48);
    for (const p of pts) box.expandByPoint(new THREE.Vector2(p.x, p.y));
  }
  const svgW = box.max.x - box.min.x;
  const svgH = box.max.y - box.min.y;
  const svgCx = (box.min.x + box.max.x) * 0.5;
  const svgCy = (box.min.y + box.max.y) * 0.5;

  // Scale: fit within a target size on the front face
  const targetSize = 0.2;
  const scale = targetSize / Math.max(svgW, svgH);

  // Outer panel size
  const margin = 0.028;
  const outerW = svgW * scale + margin * 2;
  const outerH = svgH * scale + margin * 2;

  // Build outer shape (rounded rect)
  function roundedRectShape(w: number, h: number, r: number) {
    const s = new THREE.Shape();
    s.moveTo(-w * 0.5 + r, -h * 0.5);
    s.lineTo(w * 0.5 - r, -h * 0.5);
    s.absarc(w * 0.5 - r, 0, r, -Math.PI * 0.5, Math.PI * 0.5, false);
    s.lineTo(-w * 0.5 + r, h * 0.5);
    s.absarc(-w * 0.5 + r, 0, r, Math.PI * 0.5, -Math.PI * 0.5, false);
    s.closePath();
    return s;
  }
  const outerShape = roundedRectShape(outerW, outerH, 0.012);

  // Add character shapes as holes, centered in the outer shape
  for (const raw of rawShapes) {
    const hole = new THREE.Shape();
    const pts = raw.getPoints(48);
    for (let i = 0; i < pts.length; i++) {
      const px = (pts[i].x - svgCx) * scale;
      const py = (pts[i].y - svgCy) * scale;
      if (i === 0) hole.moveTo(px, py);
      else hole.lineTo(px, py);
    }
    hole.closePath();
    outerShape.holes.push(hole);
  }

  const panelDepth = 0.005;

  // Gold metal panel (with cutout)
  const goldMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xc8a050,
    metalness: 0.88,
    roughness: 0.16,
    clearcoat: 0.3,
    clearcoatRoughness: 0.14,
    envMapIntensity: 0.55,
    side: THREE.DoubleSide,
  });

  const panel = new THREE.Mesh(
    new THREE.ExtrudeGeometry(outerShape, { depth: panelDepth, bevelEnabled: false }),
    goldMaterial,
  );
  // Position on front face, left side, lower area
  const ventX = -bodyW * 0.32;
  const ventY = -bodyW * 0.28;
  const ventZ = bodyDepth * 0.5 + 0.005;
  panel.position.set(ventX, ventY, ventZ);
  panel.renderOrder = 6;
  vent.add(panel);

  // Recess plane behind the panel (black, slightly inset)
  const recessShape = roundedRectShape(outerW + 0.004, outerH + 0.004, 0.014);
  const recessMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x050505,
    metalness: 0.1,
    roughness: 0.85,
    envMapIntensity: 0.05,
    side: THREE.DoubleSide,
  });
  const recess = new THREE.Mesh(
    new THREE.ShapeGeometry(recessShape),
    recessMaterial,
  );
  recess.position.set(ventX, ventY, ventZ - panelDepth * 0.5 - 0.001);
  recess.renderOrder = 5;
  vent.add(recess);

  return vent;
}

function buildMicAperture(bodyW: number, bodyH: number, bodyDepth: number) {
  const mic = new THREE.Group();
  const bevel = 0.026;
  const cornerR = BODY_CORNER.radius;
  const usableHalf = bodyW * 0.5 - cornerR;
  const micX = -0.62;
  const topY = bodyH * 0.5 + bevel + 0.002;
  const micZ = 0;

  const countersinkR = 0.024;
  const boreR = 0.016;
  const countersinkDepth = 0.008;

  const sinkMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xc0c5cc,
    metalness: 0.88,
    roughness: 0.2,
    clearcoat: 0.3,
    clearcoatRoughness: 0.18,
    envMapIntensity: 0.5,
    side: THREE.DoubleSide,
  });
  const boreMaterial = new THREE.MeshBasicMaterial({
    color: 0x010101,
    side: THREE.DoubleSide,
  });
  const chamferMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xc8ccd4,
    metalness: 0.9,
    roughness: 0.15,
    clearcoat: 0.35,
    clearcoatRoughness: 0.12,
    envMapIntensity: 0.6,
    side: THREE.DoubleSide,
  });

  const sink = new THREE.Mesh(
    new THREE.CylinderGeometry(countersinkR, countersinkR, countersinkDepth, 48, 1, true),
    sinkMaterial,
  );
  sink.position.set(micX, topY - countersinkDepth * 0.5, micZ);
  mic.add(sink);

  const bore = new THREE.Mesh(new THREE.CircleGeometry(boreR, 48), boreMaterial);
  bore.rotation.x = -Math.PI * 0.5;
  bore.position.set(micX, topY - countersinkDepth + 0.001, micZ);
  mic.add(bore);

  const chamfer = new THREE.Mesh(
    new THREE.RingGeometry(countersinkR - 0.002, countersinkR + 0.002, 48),
    chamferMaterial,
  );
  chamfer.rotation.x = -Math.PI * 0.5;
  chamfer.position.set(micX, topY + 0.001, micZ);
  mic.add(chamfer);

  mic.children.forEach((child) => {
    child.renderOrder = 7;
  });

  return mic;
}

function beginDrag(
  event: ReactPointerEvent<HTMLElement>,
  dragRef: MutableRefObject<DragState | undefined>,
  rotationRef: MutableRefObject<ViewRotation>,
  sceneRef: MutableRefObject<HardwareScene | undefined>,
) {
  if (event.button !== 0) {
    return;
  }

  event.currentTarget.setPointerCapture(event.pointerId);
  rotationRef.current = sceneRef.current?.getRotation() ?? rotationRef.current;
  sceneRef.current?.setDragging(true);
  dragRef.current = {
    id: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    base: { ...rotationRef.current },
  };
}

function updateDrag(
  event: ReactPointerEvent<HTMLElement>,
  dragRef: MutableRefObject<DragState | undefined>,
  rotationRef: MutableRefObject<ViewRotation>,
  sceneRef: MutableRefObject<HardwareScene | undefined>,
) {
  const drag = dragRef.current;
  if (!drag || drag.id !== event.pointerId) {
    return;
  }

  const next = {
    x: clamp(drag.base.x + (event.clientY - drag.startY) / 170, -0.78, 0.78),
    y: drag.base.y + (event.clientX - drag.startX) / 115,
  };
  rotationRef.current = next;
  sceneRef.current?.setDragging(true);
  sceneRef.current?.setRotation(next);
}

function endDrag(
  event: ReactPointerEvent<HTMLElement>,
  dragRef: MutableRefObject<DragState | undefined>,
  sceneRef: MutableRefObject<HardwareScene | undefined>,
) {
  finishDrag(dragRef, sceneRef, event.pointerId);
}

function finishDrag(
  dragRef: MutableRefObject<DragState | undefined>,
  sceneRef: MutableRefObject<HardwareScene | undefined>,
  pointerId?: number,
) {
  if (!dragRef.current) {
    return;
  }

  if (pointerId !== undefined && dragRef.current.id !== pointerId) {
    return;
  }

  dragRef.current = undefined;
  sceneRef.current?.setDragging(false);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundedRect(width: number, height: number, radius: number) {
  const x = -width / 2;
  const y = -height / 2;
  const r = Math.min(radius, width / 2, height / 2);
  const shape = new THREE.Shape();

  shape.moveTo(x + r, y);
  shape.lineTo(x + width - r, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + r);
  shape.lineTo(x + width, y + height - r);
  shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  shape.lineTo(x + r, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  shape.closePath();

  return shape;
}

function squircleRect(
  width: number,
  height: number,
  radius: number,
  exponentX: number,
  exponentY: number,
) {
  const points = squircleRectPoints({
    x: -width / 2,
    y: -height / 2,
    width,
    height,
    radius,
    exponentX,
    exponentY,
  });
  const shape = new THREE.Shape();

  shape.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => {
    shape.lineTo(point.x, point.y);
  });
  shape.closePath();

  return shape;
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      disposeMaterial(child.material);
    }
  });
}

function disposeMaterial(material: THREE.Material | THREE.Material[]) {
  if (Array.isArray(material)) {
    material.forEach((item) => item.dispose());
    return;
  }

  const mapped = material as THREE.Material & { map?: THREE.Texture | null };
  mapped.map?.dispose();
  material.dispose();
}
