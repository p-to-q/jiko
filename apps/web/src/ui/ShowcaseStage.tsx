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
  { x: -0.18, y: -0.62 },
  { x: 0.04, y: 0.46 },
  { x: -0.1, y: 0.04 },
  { x: -0.08, y: Math.PI - 0.18 },
  { x: -0.12, y: -Math.PI + 0.2 },
];
const CELEBRATION_DURATION_MS = 3600;
const CELEBRATION_TURNS = Math.PI * 4;
const CELEBRATION_EVENT = "jiko:celebrate";

type ViewRotation = { x: number; y: number };
type DragState = {
  id: number;
  startX: number;
  startY: number;
  base: ViewRotation;
};
type CelebrationSpin = {
  start: number;
  fromX: number;
  fromY: number;
  fromPositionY: number;
  direction: -1 | 1;
  bobAmplitude: number;
  bobPhase: number;
  pop: number;
};

export function ShowcaseStage({
  surface = "standalone",
}: {
  surface?: "standalone" | "embedded";
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HardwareScene>();
  const rotationRef = useRef<ViewRotation>({ ...DEFAULT_ROTATION });
  const dragRef = useRef<DragState>();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const scene = createHardwareScene(host, (rotation) => {
      rotationRef.current = rotation;
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
  let lastRotation = { x: Number.NaN, y: Number.NaN };
  let idleTarget = nextIdleRotation();
  let nextIdleTurnAt = performance.now() + 1800;
  let idlePausedUntil = 0;
  let celebrationSpin: CelebrationSpin | undefined;

  const render = (time: number) => {
    screenTexture.update(time);

    if (celebrationSpin && !dragging) {
      const progress = clamp((time - celebrationSpin.start) / CELEBRATION_DURATION_MS, 0, 1);
      const eased = easeInOutBezier(progress);
      const envelope = Math.sin(progress * Math.PI);
      const popProgress = clamp((time - celebrationSpin.start) / 340, 0, 1);
      const pop = Math.sin(popProgress * Math.PI) * celebrationSpin.pop;
      const bob = Math.sin(progress * Math.PI * 6 + celebrationSpin.bobPhase) *
        celebrationSpin.bobAmplitude *
        envelope;
      const lift = envelope;

      hardware.rotation.x = celebrationSpin.fromX - lift * 0.12 + pop * 0.24;
      hardware.rotation.y = celebrationSpin.fromY +
        celebrationSpin.direction * CELEBRATION_TURNS * eased;
      hardware.position.y = celebrationSpin.fromPositionY + bob + pop;

      if (progress >= 1) {
        const normalizedY = normalizeRotationY(hardware.rotation.y);
        hardware.rotation.y = normalizedY;
        hardware.position.y = celebrationSpin.fromPositionY;
        idleTarget = nextIdleRotation({ x: hardware.rotation.x, y: normalizedY });
        nextIdleTurnAt = time + randomBetween(1200, 2200);
        idlePausedUntil = 0;
        celebrationSpin = undefined;
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
      celebrationSpin = {
        start: now,
        fromX: hardware.rotation.x,
        fromY: hardware.rotation.y,
        fromPositionY: hardware.position.y,
        direction: Math.random() < 0.5 ? -1 : 1,
        bobAmplitude: randomBetween(0.12, 0.19),
        bobPhase: randomBetween(0, Math.PI * 2),
        pop: randomBetween(0.1, 0.16),
      };
      dragging = false;
      nextIdleTurnAt = now + CELEBRATION_DURATION_MS + 1200;
      idlePausedUntil = 0;
    },
    dispose() {
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
  return Math.max(8.15, horizontalFitDistance);
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

  const apertureMaterial = new THREE.MeshBasicMaterial({
    color: 0x020202,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });
  const bevelMaterial = new THREE.MeshBasicMaterial({
    color: 0xaeb8c8,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
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
  const bottomY = -bodyH * 0.5 - 0.008;
  const portZ = 0;

  const recessMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x101316,
    metalness: 0.36,
    roughness: 0.54,
    clearcoat: 0.12,
    clearcoatRoughness: 0.58,
    envMapIntensity: 0.18,
    side: THREE.DoubleSide,
  });
  const portInteriorMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.94,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const portLipMaterial = new THREE.MeshBasicMaterial({
    color: 0xaeb8c8,
    transparent: true,
    opacity: 0.14,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  const recess = new THREE.Mesh(
    new THREE.ShapeGeometry(
      squircleRect(
        0.31,
        0.108,
        DETAIL_CORNER.radius * 1.6,
        DETAIL_CORNER.exponent,
        DETAIL_CORNER.exponent,
      ),
    ),
    recessMaterial,
  );
  recess.rotation.x = Math.PI * 0.5;
  recess.position.set(0, bottomY, portZ);
  port.add(recess);

  const innerMouth = new THREE.Mesh(
    new THREE.ShapeGeometry(
      squircleRect(
        0.19,
        0.058,
        DETAIL_CORNER.radius,
        DETAIL_CORNER.exponent,
        DETAIL_CORNER.exponent,
      ),
    ),
    portInteriorMaterial,
  );
  innerMouth.rotation.copy(recess.rotation);
  innerMouth.position.set(0, bottomY - 0.002, portZ + 0.001);
  port.add(innerMouth);

  const lip = new THREE.Mesh(
    new THREE.ShapeGeometry(
      squircleRect(
        0.23,
        0.078,
        DETAIL_CORNER.radius * 1.2,
        DETAIL_CORNER.exponent,
        DETAIL_CORNER.exponent,
      ),
    ),
    portLipMaterial,
  );
  lip.rotation.copy(recess.rotation);
  lip.position.set(0, bottomY - 0.003, portZ + 0.002);
  port.add(lip);

  const lowerEdgeReveal = new THREE.Mesh(
    new THREE.ShapeGeometry(roundedRect(0.22, 0.018, 0.009)),
    portInteriorMaterial,
  );
  lowerEdgeReveal.position.set(0, -bodyH * 0.5 + 0.012, bodyDepth * 0.515);
  port.add(lowerEdgeReveal);

  return port;
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
