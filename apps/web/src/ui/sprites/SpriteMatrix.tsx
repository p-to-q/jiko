import { useEffect, useState, type CSSProperties } from "react";
import {
  animations,
  frames,
  palettes,
  spriteSize,
  type SpriteAnimation,
  type SpriteName,
  type SpriteTone,
} from "./data";

type SpriteMatrixProps = {
  name: SpriteName;
  tone?: SpriteTone;
  animation?: SpriteAnimation;
  // Dot diameter / grid cell, in device px.
  cell?: number;
  gap?: number;
  playing?: boolean;
  showOffDots?: boolean;
  className?: string;
  fpsOverride?: number;
  frameIndexOverride?: number;
};

type CSSVars = CSSProperties & Record<string, string>;

function sequenceFor(name: SpriteName, animation: SpriteAnimation): readonly string[] {
  return animations[animation].characters[name];
}

// Steps through the scene's frame sequence at its fps. Hard frame swaps keep the
// pixel sprite crisp (no cross-fade), and re-rendering 81 dots a few times a
// second is cheap — no animation library needed.
function useSpriteFrame(
  name: SpriteName,
  animation: SpriteAnimation,
  playing: boolean,
  fpsOverride?: number,
  frameIndexOverride?: number,
): readonly string[] {
  const sequence = sequenceFor(name, animation);
  const fps = fpsOverride ?? animations[animation].fps;
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (frameIndexOverride !== undefined) {
      return;
    }

    setIndex(0);

    if (!playing || sequence.length <= 1) {
      return;
    }

    const id = window.setInterval(
      () => setIndex((value) => (value + 1) % sequence.length),
      Math.max(80, Math.round(1000 / fps)),
    );

    return () => window.clearInterval(id);
  }, [name, animation, playing, fps, sequence.length, frameIndexOverride]);

  const table = frames[name] as Record<string, readonly string[]>;
  const resolvedIndex = frameIndexOverride ?? index;
  return table[sequence[resolvedIndex % sequence.length]] ?? Object.values(table)[0];
}

// King / Tree / Oracle pixel sprite, rendered as round LED dots. Colors come from
// the tone palette (orange is the project token #F09035).
export function SpriteMatrix({
  name,
  tone = "yellow",
  animation = "idle",
  cell = 8,
  gap = 3,
  playing = true,
  showOffDots = true,
  className = "",
  fpsOverride,
  frameIndexOverride,
}: SpriteMatrixProps) {
  const rows = useSpriteFrame(name, animation, playing, fpsOverride, frameIndexOverride);
  const palette = palettes[tone];

  const style: CSSVars = {
    gridTemplateColumns: `repeat(${spriteSize}, ${cell}px)`,
    gridAutoRows: `${cell}px`,
    gap: `${gap}px`,
    "--sprite-primary": palette.primary,
    "--sprite-secondary": palette.secondary,
    "--sprite-dim": palette.dim,
    "--sprite-halo": palette.halo,
    "--sprite-cell": `${cell}px`,
  };

  return (
    <div
      className={["sprite-matrix", className].filter(Boolean).join(" ")}
      style={style}
      data-sprite={name}
      data-tone={tone}
      role="img"
      aria-label={name}
    >
      {rows.flatMap((row, y) =>
        [...row].map((dot, x) => (
          <span
            key={`${y}-${x}`}
            className={
              dot === "1"
                ? "sprite-dot is-primary"
                : dot === "2"
                  ? "sprite-dot is-secondary"
                  : showOffDots
                    ? "sprite-dot is-off"
                    : "sprite-dot is-hidden"
            }
          />
        )),
      )}
    </div>
  );
}
