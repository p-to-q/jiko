import { type CSSProperties } from "react";
import { GLYPH_ROWS, glyphFor, type Glyph } from "./dotMatrixFont";

type DotMatrixProps = {
  text: string;
  // Diameter of one LED dot, in device px.
  dot?: number;
  // Gap between dots inside a glyph, in device px.
  gap?: number;
  // Gap between glyphs, in device px. Defaults to one dot width.
  tracking?: number;
  // Dot color. Defaults to inherited currentColor.
  color?: string;
  className?: string;
  ariaLabel?: string;
  "data-colon"?: "on" | "off";
};

type CSSVars = CSSProperties & Record<string, string>;

export function DotMatrix({
  text,
  dot = 3,
  gap = 1,
  tracking,
  color,
  className,
  ariaLabel,
  "data-colon": colon,
}: DotMatrixProps) {
  const style: CSSVars = {
    "--dot": `${dot}px`,
    "--gap": `${gap}px`,
    columnGap: `${tracking ?? dot}px`,
  };

  if (color) {
    style.color = color;
  }

  return (
    <span
      className={["dot-matrix", className].filter(Boolean).join(" ")}
      style={style}
      data-colon={colon}
      role="img"
      aria-label={ariaLabel ?? text}
    >
      {[...text].map((char, index) => (
        <DotGlyph key={`${char}-${index}`} char={char} glyph={glyphFor(char)} />
      ))}
    </span>
  );
}

function DotGlyph({ char, glyph }: { char: string; glyph: Glyph }) {
  const width = glyph[0]?.length ?? 0;
  const dots: Array<{ col: number; row: number }> = [];

  glyph.forEach((row, rowIndex) => {
    for (let col = 0; col < row.length; col += 1) {
      if (row[col] === "1") {
        dots.push({ col, row: rowIndex });
      }
    }
  });

  return (
    <span
      className="dm-glyph"
      data-char={char}
      style={{
        gridTemplateColumns: `repeat(${width}, var(--dot))`,
        gridTemplateRows: `repeat(${GLYPH_ROWS}, var(--dot))`,
      }}
    >
      {dots.map(({ col, row }) => (
        <span
          key={`${col}-${row}`}
          style={{ gridColumn: col + 1, gridRow: row + 1 }}
        />
      ))}
    </span>
  );
}
