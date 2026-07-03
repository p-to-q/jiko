import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type MutableRefObject,
} from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { createShowcaseScreenTexture } from "./showcaseScreenTexture";

const SCREEN_ASPECT = 2 / 3;
const DEFAULT_ROTATION = { x: -0.08, y: -0.22 };

type ViewRotation = { x: number; y: number };
type DragState = {
  id: number;
  startX: number;
  startY: number;
  base: ViewRotation;
};

export function ShowcaseStage({ surface = "standalone" }: { surface?: "standalone" | "embedded" }) {
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

    window.addEventListener("pointerup", finishPointer);
    window.addEventListener("pointercancel", finishPointer);
    window.addEventListener("mouseup", finishAnyPointer);
    window.addEventListener("touchend", finishAnyPointer);
    window.addEventListener("blur", finishAnyPointer);

    return () => {
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
  renderer.toneMappingExposure = 0.56;
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

  const warmFloor = new THREE.DirectionalLight(0xffb875, 0.42);
  warmFloor.position.set(-2.2, -3.8, 4.4);
  scene.add(warmFloor);

  const amberGlance = new THREE.DirectionalLight(0xffc06a, 0.58);
  amberGlance.position.set(-4.6, 2.2, 3.8);
  scene.add(amberGlance);

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

  const render = (time: number) => {
    screenTexture.update(time);

    if (!dragging) {
      hardware.rotation.x = THREE.MathUtils.lerp(hardware.rotation.x, DEFAULT_ROTATION.x, 0.018);
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
  const horizontalFitDistance = 3.72 / (2 * Math.tan(verticalRadians / 2) * aspect);
  return Math.max(9.2, horizontalFitDistance);
}

function buildHardware(screenTexture: THREE.Texture) {
  const group = new THREE.Group();
  const bodyW = 1.82;
  const bodyH = bodyW / SCREEN_ASPECT;
  const bodyDepth = 0.15;
  const bodyRadius = 0.15;

  const shellMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x010101,
    metalness: 0.22,
    roughness: 0.58,
    clearcoat: 0.24,
    clearcoatRoughness: 0.44,
    envMapIntensity: 0.12,
    reflectivity: 0.18,
  });

  const body = new THREE.Mesh(
    new THREE.ExtrudeGeometry(roundedRect(bodyW, bodyH, bodyRadius), {
      depth: bodyDepth,
      bevelEnabled: true,
      bevelSize: 0.038,
      bevelThickness: 0.038,
      bevelSegments: 18,
      curveSegments: 34,
    }).center(),
    shellMaterial,
  );
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const backPlate = new THREE.Mesh(
    new THREE.ShapeGeometry(roundedRect(bodyW * 0.88, bodyH * 0.88, bodyRadius * 0.62)),
    new THREE.MeshPhysicalMaterial({
      color: 0x020202,
      metalness: 0.26,
      roughness: 0.6,
      clearcoat: 0.2,
      clearcoatRoughness: 0.44,
      envMapIntensity: 0.12,
    }),
  );
  backPlate.position.z = -bodyDepth * 0.515;
  backPlate.rotation.y = Math.PI;
  group.add(backPlate);

  const screenW = bodyW * 0.99;
  const screenH = screenW / SCREEN_ASPECT;

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
    new THREE.ShapeGeometry(roundedRect(screenW * 1.02, screenH * 1.012, 0.18)),
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

  const baseShadow = new THREE.Mesh(
    new THREE.CircleGeometry(1.6, 72),
    new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
    }),
  );
  baseShadow.position.set(0.18, -2.28, -0.19);
  baseShadow.scale.set(1.45, 0.24, 1);
  group.add(baseShadow);

  group.scale.setScalar(0.9);
  return group;
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
      color: 0xffcf8a,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  glint.position.set(bodyW * 0.62, 0.22, bodyDepth * 0.2);
  side.add(glint);

  return side;
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
