import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type CSSProperties,
  type MutableRefObject,
  type PointerEvent,
  type SetStateAction,
} from "react";
import * as THREE from "three";
import { DeviceDemo } from "./DeviceDemo";

const SCREEN_W = 320;
const SCREEN_H = 480;

const VARIANTS = {
  slim: {
    label: "薄片",
    depth: 0.24,
    yaw: -0.1,
    pitch: 0.035,
    roll: -0.012,
  },
  balanced: {
    label: "均衡",
    depth: 0.38,
    yaw: -0.15,
    pitch: 0.052,
    roll: -0.012,
  },
  deep: {
    label: "厚砖",
    depth: 0.56,
    yaw: -0.22,
    pitch: 0.065,
    roll: -0.016,
  },
} as const;

type ShowcaseVariant = keyof typeof VARIANTS;
type ShowcaseMotion = "idle" | "dance";
type ViewRotation = { x: number; y: number };

export function ShowcaseStage() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const variant = resolveVariant(params);
  const motion = resolveMotion(params);
  const showLabels = params.get("labels") === "1";
  const screenRef = useRef<HTMLDivElement>(null);
  const screenScale = useScreenScale(screenRef);
  const dragRef = useRef<{ id: number; startX: number; startY: number; base: ViewRotation }>();
  const [view, setView] = useState<ViewRotation>({ x: 0, y: 0 });
  const screenTransform = resolveScreenTransform(variant, view);
  const facing = Math.cos(VARIANTS[variant].yaw + view.y) >= 0 ? "front" : "back";

  return (
    <main
      className="showcase-stage"
      data-variant={variant}
      aria-label="jiko pure hardware showcase"
      onPointerDown={(event) => beginDrag(event, dragRef, view)}
      onPointerMove={(event) => updateDrag(event, dragRef, setView)}
      onPointerUp={(event) => endDrag(event, dragRef)}
      onPointerCancel={(event) => endDrag(event, dragRef)}
    >
      <div className="showcase-text" aria-label="jiko launching soon">
        <span className="showcase-kicker">JIKO</span>
        <h1>Launching Soon</h1>
        <p>an ambient signal instrument for voice, timing, and small decisions</p>
      </div>

      <div
        className="showcase-screen-frame"
        data-facing={facing}
        ref={screenRef}
        aria-label="jiko screen"
        style={{ transform: screenTransform } as CSSProperties}
      >
        <HardwareCanvas variant={variant} />
        <span className="showcase-depth-rim" aria-hidden="true" />
        <span className="showcase-side-button" aria-hidden="true">
          <span className="showcase-key-highlight" />
        </span>
        <div
          className="showcase-screen-scale"
          style={{ transform: `translateZ(28px) scale(${screenScale})` }}
        >
          <DeviceDemo embedded demoMode={motion} showLogo={false} />
        </div>
      </div>

      {showLabels ? (
        <div className="showcase-label">
          <span>jiko</span>
          <span>{VARIANTS[variant].label}</span>
        </div>
      ) : null}
    </main>
  );
}

function HardwareCanvas({ variant }: { variant: ShowcaseVariant }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) {
      return;
    }

    const spec = VARIANTS[variant];
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(0, 0.02, 8.35);

    scene.add(new THREE.AmbientLight(0xffffff, 0.36));

    const key = new THREE.DirectionalLight(0xffffff, 2.7);
    key.position.set(-3.9, 5.2, 6.1);
    scene.add(key);

    const rim = new THREE.DirectionalLight(0xf1d9b8, 2.35);
    rim.position.set(5.4, -1.3, 4.2);
    scene.add(rim);

    const side = new THREE.DirectionalLight(0xffffff, 1.4);
    side.position.set(5.8, 1.2, 1.5);
    scene.add(side);

    const hardware = buildHardware(spec);
    scene.add(hardware);

    const resize = () => {
      const rect = host.getBoundingClientRect();
      renderer.setSize(rect.width, rect.height, false);
      camera.aspect = rect.width / Math.max(1, rect.height);
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    return () => {
      observer.disconnect();
      scene.remove(hardware);
      disposeObject(hardware);
      renderer.dispose();
    };
  }, [variant]);

  return (
    <div className="showcase-hardware-canvas" aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}

function buildHardware(spec: (typeof VARIANTS)[ShowcaseVariant]) {
  const group = new THREE.Group();
  const bodyW = 3.2;
  const bodyH = 4.8;
  const radius = 0.34;
  const bevel = Math.min(0.07, spec.depth * 0.15);

  const bodyMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x020202,
    metalness: 0.48,
    roughness: 0.26,
    clearcoat: 1,
    clearcoatRoughness: 0.13,
    reflectivity: 0.58,
  });

  const shell = new THREE.Mesh(
    new THREE.ExtrudeGeometry(roundedRect(bodyW, bodyH, radius), {
      depth: spec.depth,
      bevelEnabled: true,
      bevelSize: bevel,
      bevelThickness: bevel,
      bevelSegments: 18,
      curveSegments: 30,
    }).center(),
    bodyMaterial,
  );
  shell.position.z = -spec.depth * 0.54;
  group.add(shell);

  const faceGlow = new THREE.Mesh(
    new THREE.ShapeGeometry(roundedRect(bodyW * 0.995, bodyH * 0.995, radius * 0.96)),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.042,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  faceGlow.position.z = spec.depth * 0.055;
  group.add(faceGlow);

  const topSweep = new THREE.Mesh(
    new THREE.PlaneGeometry(bodyW * 0.86, bodyH * 0.2),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.05,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  topSweep.position.set(0, bodyH * 0.43, spec.depth * 0.07);
  group.add(topSweep);

  const rightRim = new THREE.Mesh(
    new THREE.PlaneGeometry(0.05, bodyH * 0.92),
    new THREE.MeshBasicMaterial({
      color: 0xf3dfbf,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  rightRim.position.set(bodyW / 2 - 0.012, 0, spec.depth * 0.08);
  group.add(rightRim);

  const sideKey = new THREE.Mesh(
    new THREE.ExtrudeGeometry(roundedRect(0.2, 2.58, 0.055), {
      depth: 0.18,
      bevelEnabled: true,
      bevelSize: 0.018,
      bevelThickness: 0.018,
      bevelSegments: 10,
      curveSegments: 14,
    }).center(),
    new THREE.MeshPhysicalMaterial({
      color: 0x2c2c29,
      metalness: 0.82,
      roughness: 0.28,
      clearcoat: 0.58,
      clearcoatRoughness: 0.2,
      reflectivity: 0.48,
    }),
  );
  sideKey.position.set(bodyW / 2 + 0.22, -0.03, -spec.depth * 0.09);
  sideKey.rotation.y = Math.PI * 0.5;
  group.add(sideKey);

  const sideKeyGlint = new THREE.Mesh(
    new THREE.PlaneGeometry(0.035, 2.22),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  sideKeyGlint.position.set(bodyW / 2 + 0.32, -0.03, 0.015);
  group.add(sideKeyGlint);

  group.scale.setScalar(0.72);
  return group;
}

function resolveScreenTransform(variant: ShowcaseVariant, view: ViewRotation) {
  const spec = VARIANTS[variant];
  return [
    "perspective(1400px)",
    `rotateX(${toDeg(spec.pitch + view.x)})`,
    `rotateY(${toDeg(spec.yaw + view.y)})`,
    `rotateZ(${toDeg(spec.roll + Math.sin(view.y) * 0.012)})`,
  ].join(" ");
}

function toDeg(radians: number) {
  return `${radians * (180 / Math.PI)}deg`;
}

function beginDrag(
  event: PointerEvent<HTMLElement>,
  dragRef: MutableRefObject<
    { id: number; startX: number; startY: number; base: ViewRotation } | undefined
  >,
  view: ViewRotation,
) {
  if (event.button !== 0) {
    return;
  }

  event.currentTarget.setPointerCapture(event.pointerId);
  dragRef.current = {
    id: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    base: view,
  };
}

function updateDrag(
  event: PointerEvent<HTMLElement>,
  dragRef: MutableRefObject<
    { id: number; startX: number; startY: number; base: ViewRotation } | undefined
  >,
  setView: Dispatch<SetStateAction<ViewRotation>>,
) {
  const drag = dragRef.current;
  if (!drag || drag.id !== event.pointerId) {
    return;
  }

  const next = {
    x: clamp(drag.base.x - (event.clientY - drag.startY) / 160, -0.65, 0.65),
    y: drag.base.y + (event.clientX - drag.startX) / 110,
  };
  setView(next);
}

function endDrag(
  event: PointerEvent<HTMLElement>,
  dragRef: MutableRefObject<
    { id: number; startX: number; startY: number; base: ViewRotation } | undefined
  >,
) {
  if (dragRef.current?.id === event.pointerId) {
    dragRef.current = undefined;
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function useScreenScale(ref: React.RefObject<HTMLDivElement>) {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    const update = () => {
      const rect = element.getBoundingClientRect();
      setScale(Math.min(rect.width / SCREEN_W, rect.height / SCREEN_H));
    };

    const observer = new ResizeObserver(update);
    observer.observe(element);
    update();

    return () => observer.disconnect();
  }, [ref]);

  return scale;
}

function resolveVariant(params: URLSearchParams): ShowcaseVariant {
  const value = params.get("variant");
  return value === "slim" || value === "deep" || value === "balanced" ? value : "balanced";
}

function resolveMotion(params: URLSearchParams): ShowcaseMotion {
  return params.get("motion") === "idle" ? "idle" : "dance";
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

  material.dispose();
}
