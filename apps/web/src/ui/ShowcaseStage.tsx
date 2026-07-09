import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type MutableRefObject,
} from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
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
  { x: -0.26, y: -0.62 },
  { x: 0.12, y: 0.46 },
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

    const scene = createHardwareScene(host, surface, (rotation) => {
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
  }, [surface]);

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
  surface: "standalone" | "embedded",
  onRotationFrame: (rotation: ViewRotation) => void,
  onFirstFrame?: () => void,
) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(0x000000, 0);
  const maxPixelRatio = surface === "embedded" ? 3 : 2;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio));
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

function buildHardware(screenTexture: THREE.Texture) {
  const group = new THREE.Group();
  const bodyW = 1.82;
  const bodyH = bodyW / SCREEN_ASPECT;
  const bodyDepth = 0.15;
  const bodyRadius = BODY_CORNER.radius;

  const shellMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x010101,
    metalness: 0.22,
    roughness: 0.58,
    clearcoat: 0.24,
    clearcoatRoughness: 0.44,
    envMapIntensity: 0.12,
    reflectivity: 0.18,
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
      color: 0x010101,
      metalness: 0.2,
      roughness: 0.6,
      clearcoat: 0.2,
      clearcoatRoughness: 0.46,
      envMapIntensity: 0.1,
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
      color: 0x020202,
      metalness: 0.26,
      roughness: 0.6,
      clearcoat: 0.2,
      clearcoatRoughness: 0.44,
      envMapIntensity: 0.12,
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
    color: 0x070707,
    metalness: 0.32,
    roughness: 0.58,
    clearcoat: 0.22,
    clearcoatRoughness: 0.42,
    envMapIntensity: 0.12,
    reflectivity: 0.18,
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
    color: 0x171a1d,
    metalness: 0.58,
    roughness: 0.42,
    clearcoat: 0.14,
    clearcoatRoughness: 0.5,
    envMapIntensity: 0.16,
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
  details.add(buildThermalMark(bodyW, bodyH, bodyDepth));

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
  const frontZ = bodyDepth * 0.505 + 0.003;

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
    color: 0x8a96a6,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const frontRimMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x9aa6b5,
    metalness: 0.62,
    roughness: 0.34,
    clearcoat: 0.24,
    clearcoatRoughness: 0.38,
    envMapIntensity: 0.42,
    side: THREE.DoubleSide,
  });

  const btmRecessMat = recessMaterial.clone();
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
    btmRecessMat,
  );
  recess.rotation.x = Math.PI * 0.5;
  recess.position.set(0, bottomY, portZ);
  syncSurfaceDepth(recess, btmRecessMat);
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

  const btmInteriorMat = portInteriorMaterial.clone();
  const innerMouth = new THREE.Mesh(
    new THREE.ExtrudeGeometry(usbCShape, { depth: 0.006, bevelEnabled: false }),
    btmInteriorMat,
  );
  innerMouth.rotation.copy(recess.rotation);
  innerMouth.position.set(0, bottomY - 0.002, portZ);
  syncSurfaceDepth(innerMouth, btmInteriorMat);
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
  const btmTongueMat = new THREE.MeshPhysicalMaterial({
    color: 0x0a0c0f,
    metalness: 0.28,
    roughness: 0.62,
    envMapIntensity: 0.1,
    side: THREE.DoubleSide,
  });
  const bottomTongue = new THREE.Mesh(
    new THREE.ExtrudeGeometry(tongueShape, { depth: 0.004, bevelEnabled: false }),
    btmTongueMat,
  );
  bottomTongue.rotation.copy(recess.rotation);
  bottomTongue.position.set(0, bottomY - 0.003, portZ);
  syncSurfaceDepth(bottomTongue, btmTongueMat);
  port.add(bottomTongue);

  const btmLipMat = portLipMaterial.clone();
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
    btmLipMat,
  );
  lip.rotation.copy(recess.rotation);
  lip.position.set(0, bottomY - 0.003, portZ);
  syncSurfaceDepth(lip, btmLipMat);
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
      color: 0x7a8898,
      transparent: true,
      opacity: 0.10,
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

function syncSurfaceDepth(mesh: THREE.Mesh, material: THREE.Material, threshold = 0.08) {
  const faceDir = new THREE.Vector3();
  const meshPos = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  const toCamera = new THREE.Vector3();

  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    faceDir.set(0, 0, 1).transformDirection(mesh.matrixWorld);
    mesh.getWorldPosition(meshPos);
    camera.getWorldPosition(camPos);
    toCamera.copy(camPos).sub(meshPos).normalize();
    material.depthTest = faceDir.dot(toCamera) <= threshold;
  };
}

function buildMicAperture(bodyW: number, bodyH: number, bodyDepth: number) {
  const mic = new THREE.Group();
  const bevel = 0.026;
  const cornerR = BODY_CORNER.radius;
  const micX = -(bodyW * 0.5 - 2 * cornerR);
  const topY = bodyH * 0.5 + bevel;
  const micZ = 0;

  const countersinkR = 0.024;
  const boreR = 0.016;

  // 凹陷区域：深色圆面，贴合顶面
  const sinkMaterial = new THREE.MeshBasicMaterial({
    color: 0x080a0d,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const sink = new THREE.Mesh(
    new THREE.CircleGeometry(countersinkR, 48),
    sinkMaterial,
  );
  sink.rotation.x = -Math.PI * 0.5;
  sink.position.set(micX, topY + 0.001, micZ);
  sink.renderOrder = 7;
  syncSurfaceDepth(sink, sinkMaterial);
  mic.add(sink);

  // 孔洞中心：纯黑
  const boreMaterial = new THREE.MeshBasicMaterial({
    color: 0x010101,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const bore = new THREE.Mesh(new THREE.CircleGeometry(boreR, 48), boreMaterial);
  bore.rotation.x = -Math.PI * 0.5;
  bore.position.set(micX, topY + 0.0015, micZ);
  bore.renderOrder = 8;
  syncSurfaceDepth(bore, boreMaterial);
  mic.add(bore);

  // 边缘倒角高光
  const chamferMaterial = new THREE.MeshBasicMaterial({
    color: 0xc0cad8,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const chamfer = new THREE.Mesh(
    new THREE.RingGeometry(countersinkR - 0.002, countersinkR + 0.003, 48),
    chamferMaterial,
  );
  chamfer.rotation.x = -Math.PI * 0.5;
  chamfer.position.set(micX, topY + 0.002, micZ);
  chamfer.renderOrder = 9;
  syncSurfaceDepth(chamfer, chamferMaterial);
  mic.add(chamfer);

  return mic;
}

// 热字解构路径 — potrace 内部坐标（像素×10），配合 canvas transform 使用
// viewBox 原图 1482×1532，transform: translate(0,H) scale(W/14820, -H/15320)
const THERMAL_SHOU =
  "M4235 14918 c-3 -7 -6 -479 -8 -1048 -2 -1035 -2 -1035 -1277 -1040 -1275 -5 -1275 -5 -1275 -185 0 -180 0 -180 1245 -186 926 -4 1250 -8 1266 -17 30 -16 37 -192 37 -932 0 -614 -6 -738 -40 -771 -22 -22 -147 -69 -185 -69 -15 0 -29 -4 -32 -9 -3 -5 -23 -11 -43 -14 -21 -2 -92 -16 -158 -31 -66 -14 -147 -31 -180 -37 -33 -6 -82 -15 -110 -20 -27 -6 -77 -14 -110 -19 -33 -5 -80 -14 -105 -19 -25 -5 -117 -21 -205 -36 -88 -15 -182 -31 -210 -36 -27 -5 -84 -14 -125 -19 -138 -18 -275 -42 -455 -81 -55 -11 -118 -23 -140 -25 -22 -3 -49 -9 -60 -14 -11 -5 -40 -11 -65 -14 -25 -2 -70 -9 -100 -15 -103 -19 -245 -41 -359 -56 -114 -14 -177 -30 -195 -46 -6 -5 -18 -9 -27 -9 -38 0 -25 -33 161 -408 106 -213 196 -396 200 -407 5 -11 54 -114 111 -230 175 -357 239 -427 338 -369 33 19 117 121 132 161 4 11 13 24 19 28 6 3 21 27 35 53 51 97 212 212 296 212 10 0 21 5 24 10 3 6 15 10 26 10 10 0 27 4 37 10 9 5 49 21 87 35 39 15 88 34 110 44 22 10 56 23 75 30 93 32 226 84 234 92 6 5 20 9 32 9 13 0 26 5 29 10 3 6 14 10 24 10 10 0 33 8 52 17 19 10 68 29 109 44 135 48 145 52 162 60 10 5 24 9 33 9 8 0 30 9 50 20 20 11 42 20 50 20 8 0 31 7 52 16 21 9 47 20 58 24 232 82 283 99 320 102 52 4 58 -120 51 -957 -10 -1029 -5 -1020 -506 -1019 -135 1 -351 8 -481 18 -130 9 -306 16 -390 16 -190 0 -606 16 -878 35 -223 16 -231 15 -231 -38 0 -127 37 -147 366 -197 118 -18 473 -127 586 -179 36 -17 69 -31 73 -31 16 0 133 -61 145 -75 7 -8 20 -15 30 -15 10 0 23 -7 30 -15 7 -8 16 -15 21 -15 44 0 312 -270 337 -340 8 -22 149 -239 181 -277 14 -18 37 -46 49 -63 49 -63 147 -80 357 -60 72 7 180 16 240 20 114 8 189 18 335 45 47 9 104 19 128 22 23 3 45 10 48 14 3 5 16 9 29 9 13 0 27 5 30 10 3 6 18 10 33 10 15 0 52 9 82 21 30 11 67 24 81 29 129 40 325 157 441 262 98 89 201 273 240 428 40 162 57 803 58 2151 0 726 0 726 23 737 12 6 58 22 102 37 44 14 89 30 100 34 11 5 67 23 125 41 58 18 114 36 125 40 11 4 46 16 77 25 32 9 60 21 64 26 3 5 23 9 44 9 21 0 42 5 45 10 3 6 16 10 29 10 12 0 26 4 32 9 5 5 38 18 74 29 36 12 90 30 120 42 30 12 64 24 75 27 11 2 29 9 40 13 11 5 56 21 100 35 44 14 88 31 97 36 10 5 26 9 36 9 10 0 22 4 28 9 5 5 72 30 149 56 77 25 148 51 157 56 10 5 24 9 32 9 8 0 31 8 53 19 21 10 76 31 123 46 47 15 103 36 124 46 22 11 48 19 57 19 10 0 21 5 24 10 3 6 16 10 29 10 12 0 26 4 32 8 5 5 32 17 59 27 135 48 185 90 185 156 0 38 -89 55 -212 40 -46 -6 -164 -20 -263 -31 -164 -19 -331 -42 -395 -56 -14 -3 -56 -10 -95 -15 -93 -12 -184 -26 -215 -33 -14 -3 -110 -20 -215 -37 -104 -17 -212 -36 -240 -41 -77 -14 -174 -28 -235 -34 -30 -3 -59 -10 -64 -15 -6 -5 -25 -9 -44 -9 -18 0 -52 -4 -75 -9 -93 -20 -243 -43 -262 -40 -36 7 -39 61 -40 794 0 813 -115 728 955 705 784 -16 1398 -18 1435 -4 17 7 50 18 75 25 91 27 142 86 113 130 -40 61 -181 192 -230 215 -28 13 -55 29 -58 35 -4 5 -17 14 -28 19 -12 5 -44 23 -72 39 -27 17 -71 42 -96 55 -26 14 -67 39 -92 56 -25 16 -49 30 -55 30 -5 0 -15 7 -22 15 -7 9 -33 25 -56 35 -24 11 -45 24 -49 29 -3 6 -29 21 -59 35 -29 14 -59 32 -66 41 -7 8 -16 15 -21 15 -5 0 -28 12 -52 27 -23 15 -62 38 -87 51 -25 14 -52 30 -60 37 -54 46 -192 88 -290 89 -107 0 -133 -12 -293 -143 -66 -53 -131 -105 -145 -116 -450 -337 -451 -338 -641 -333 -106 3 -106 3 -109 665 -2 745 -19 657 145 792 155 127 263 261 263 324 0 27 -58 63 -125 77 -22 5 -67 16 -100 24 -92 24 -280 50 -615 86 -102 11 -203 24 -225 29 -22 5 -87 15 -145 21 -200 22 -536 65 -593 76 -17 4 -29 1 -32 -8z";

const THERMAL_WAN =
  "M4086 5708 c-3 -13 -7 -282 -10 -598 -4 -316 -9 -608 -13 -647 -6 -73 -6 -73 -590 -73 -584 0 -584 0 -581 -117 3 -118 3 -118 563 -123 649 -6 612 35 524 -580 -11 -74 -24 -164 -29 -200 -22 -160 -60 -345 -75 -370 -10 -17 -129 -11 -237 11 -445 91 -639 119 -811 119 -173 0 -203 -52 -62 -105 33 -13 105 -40 160 -61 55 -20 142 -57 193 -81 52 -23 96 -43 99 -43 6 0 183 -83 218 -102 10 -6 37 -21 60 -33 162 -88 204 -120 205 -158 1 -53 -99 -277 -190 -425 -25 -41 -49 -81 -55 -90 -202 -338 -701 -817 -1262 -1212 -199 -139 -200 -140 -333 -222 -269 -166 -249 -146 -195 -201 49 -50 104 -45 270 22 203 83 438 180 550 228 137 58 554 272 670 344 17 10 44 26 60 35 376 210 862 643 1073 955 162 239 157 235 223 192 298 -192 645 -523 762 -725 56 -97 157 -148 309 -155 680 -35 653 668 -42 1092 -103 63 -427 225 -450 225 -6 0 -18 4 -28 9 -16 9 -190 78 -305 121 -31 12 -57 25 -57 29 0 7 20 75 54 181 76 235 136 524 171 825 15 124 46 290 63 336 10 26 10 26 463 32 831 13 928 11 933 -15 3 -13 7 -230 9 -483 5 -469 7 -510 57 -915 21 -169 43 -283 87 -450 14 -52 31 -117 38 -145 25 -97 171 -479 196 -510 4 -6 29 -51 54 -100 26 -50 53 -97 61 -106 8 -8 14 -19 14 -23 0 -6 29 -50 115 -172 85 -120 393 -424 431 -424 3 0 23 -13 44 -30 21 -16 40 -30 43 -30 3 0 26 -14 51 -30 331 -224 966 -328 1266 -208 113 45 181 106 232 208 43 87 -17 316 -132 496 -70 111 -84 433 -47 1114 15 276 15 276 -37 266 -46 -9 -81 -51 -96 -118 -24 -106 -170 -581 -200 -653 -5 -11 -25 -67 -45 -125 -47 -134 -107 -256 -147 -297 -173 -179 -585 126 -813 603 -87 180 -104 224 -155 409 -92 326 -120 573 -120 1050 1 497 16 557 147 581 96 17 213 95 213 141 0 84 -314 285 -733 470 -159 70 -182 61 -565 -206 -72 -51 -72 -51 -708 -51 -636 0 -636 0 -630 43 15 111 19 189 25 537 6 374 6 374 36 390 16 8 37 22 47 31 10 9 48 33 84 54 247 145 108 184 -961 275 -154 13 -154 14 -159 -12z";

const THERMAL_HUO: readonly string[] = [
  "M11285 14975 c-851 -133 -1542 -1122 -1869 -2675 -91 -434 -90 -581 4 -620 43 -18 28 -36 242 290 559 851 1283 1410 2148 1656 148 42 184 64 234 138 126 190 170 673 78 855 -57 112 -201 260 -307 314 -108 55 -333 73 -530 42z",
  "M11145 10719 c-725 -55 -1397 -842 -1809 -2116 -48 -149 -47 -184 5 -279 41 -75 41 -75 193 73 548 539 1206 855 1991 958 249 32 226 20 286 150 146 317 150 608 12 883 -138 276 -309 359 -678 331z",
  "M11157 6799 c-320 -31 -604 -175 -899 -457 -426 -408 -777 -1013 -657 -1133 38 -38 161 -22 334 41 223 83 467 140 775 182 67 9 240 13 580 13 546 0 504 -6 571 84 192 262 232 455 153 734 -103 363 -442 575 -857 536z",
  "M10175 3044 c-16 -2 -70 -9 -120 -15 -224 -27 -465 -92 -516 -140 -25 -24 -29 -34 -29 -84 0 -74 28 -103 132 -134 260 -79 347 -118 501 -221 372 -250 767 -774 953 -1268 177 -466 525 -686 851 -537 368 167 407 1049 69 1554 -255 381 -671 669 -1132 785 -185 47 -570 80 -709 60z",
];

function syncLeftFaceDepth(
  mesh: THREE.Mesh,
  material: THREE.MeshBasicMaterial,
  baseOpacity: number,
) {
  const faceDir = new THREE.Vector3();
  const meshPos = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  const toCamera = new THREE.Vector3();

  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    faceDir.set(0, 0, 1).transformDirection(mesh.matrixWorld);
    mesh.getWorldPosition(meshPos);
    camera.getWorldPosition(camPos);
    toCamera.copy(camPos).sub(meshPos).normalize();
    const facing = faceDir.dot(toCamera);
    material.depthTest = facing <= 0.05;
    const t = Math.min(1, Math.max(0, (facing - 0.05) / 0.25));
    material.opacity = t * baseOpacity;
  };
}

function buildThermalMark(bodyW: number, bodyH: number, bodyDepth: number) {
  const group = new THREE.Group();

  const bevelThickness = 0.026;
  const safeHalf = bodyDepth / 2 - bevelThickness - 0.004;
  const markW = safeHalf * 2 * 1.35;
  const markH = markW * 1.55;

  const faceX = -(bodyW / 2 + 0.004);
  const markY = -bodyH * 0.26;

  const CS = 1024;
  const paths = [THERMAL_SHOU, THERMAL_WAN, ...THERMAL_HUO];

  const cvs = document.createElement("canvas");
  cvs.width = CS;
  cvs.height = CS;
  const ctx = cvs.getContext("2d")!;
  ctx.setTransform(CS / 14820, 0, 0, -(CS / 15320), 0, CS);

  ctx.fillStyle = "rgba(45, 42, 38, 1)";
  for (const p of paths) ctx.fill(new Path2D(p));

  ctx.resetTransform();

  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;

  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(markW, markH), mat);
  mesh.rotation.y = -Math.PI / 2;
  mesh.position.set(faceX - 0.001, markY, 0);
  mesh.renderOrder = 6;
  syncLeftFaceDepth(mesh, mat, 0.92);
  group.add(mesh);

  const hCvs = document.createElement("canvas");
  hCvs.width = CS;
  hCvs.height = CS;
  const hc = hCvs.getContext("2d")!;
  hc.setTransform(CS / 14820, 0, 0, -(CS / 15320), 0, CS);
  hc.strokeStyle = "rgba(210, 218, 228, 1)";
  hc.lineWidth = 700;
  hc.lineJoin = "round";
  hc.lineCap = "round";
  for (const p of paths) hc.stroke(new Path2D(p));
  hc.resetTransform();

  const haloTex = new THREE.CanvasTexture(hCvs);
  haloTex.colorSpace = THREE.SRGBColorSpace;
  haloTex.anisotropy = 8;

  const haloMat = new THREE.MeshBasicMaterial({
    map: haloTex,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(markW, markH), haloMat);
  halo.rotation.y = -Math.PI / 2;
  halo.position.set(faceX - 0.0005, markY, 0);
  halo.renderOrder = 5;
  syncLeftFaceDepth(halo, haloMat, 0.35);
  group.add(halo);

  return group;
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
