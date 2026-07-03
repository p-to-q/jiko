export type SquirclePoint = {
  x: number;
  y: number;
};

export function squircleRectPoints({
  x,
  y,
  width,
  height,
  radius,
  exponentX,
  exponentY,
  stepsPerCorner = 30,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  exponentX: number;
  exponentY: number;
  stepsPerCorner?: number;
}) {
  const r = Math.min(radius, width / 2, height / 2);
  const points: SquirclePoint[] = [];

  const pushArc = (
    centerX: number,
    centerY: number,
    start: number,
    end: number,
    skipLast = false,
  ) => {
    const lastStep = skipLast ? stepsPerCorner - 1 : stepsPerCorner;
    for (let index = 1; index <= lastStep; index += 1) {
      const angle = start + (index / stepsPerCorner) * (end - start);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      points.push({
        x: centerX + r * Math.sign(cos) * Math.abs(cos) ** (2 / exponentX),
        y: centerY + r * Math.sign(sin) * Math.abs(sin) ** (2 / exponentY),
      });
    }
  };

  points.push({ x: x + r, y });
  points.push({ x: x + width - r, y });
  pushArc(x + width - r, y + r, -Math.PI / 2, 0);
  points.push({ x: x + width, y: y + height - r });
  pushArc(x + width - r, y + height - r, 0, Math.PI / 2);
  points.push({ x: x + r, y: y + height });
  pushArc(x + r, y + height - r, Math.PI / 2, Math.PI);
  points.push({ x, y: y + r });
  pushArc(x + r, y + r, Math.PI, Math.PI * 1.5, true);

  return points;
}
