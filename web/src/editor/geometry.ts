import { z } from "zod";

export type Bbox = [number, number, number, number];
export const coordinateSchema = z.number().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
export const bboxSchema = z
  .tuple([coordinateSchema, coordinateSchema, coordinateSchema, coordinateSchema])
  .refine(([y0, x0, y1, x1]) => y0 <= y1 && x0 <= x1, "Expected [y_min, x_min, y_max, x_max]")
  .transform(clampBbox);
export const hexColorSchema = z.string().regex(/^#[0-9A-F]{6}$/);
export type Point = { x: number; y: number };
export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export function clampCoord(value: number): number {
  return Math.max(0, Math.min(1000, value));
}

export function normalizeBbox([y0, x0, y1, x1]: Bbox): Bbox {
  return [Math.min(y0, y1), Math.min(x0, x1), Math.max(y0, y1), Math.max(x0, x1)];
}

export function clampBbox(box: Bbox): Bbox {
  return normalizeBbox([clampCoord(box[0]), clampCoord(box[1]), clampCoord(box[2]), clampCoord(box[3])]);
}

export function bboxFromPoints(a: Point, b: Point): Bbox {
  return clampBbox([a.y, a.x, b.y, b.x]);
}

export function moveBbox(initial: Bbox, dx: number, dy: number): Bbox {
  const box = clampBbox(initial);
  const h = box[2] - box[0];
  const w = box[3] - box[1];
  const y = Math.max(0, Math.min(1000 - h, box[0] + dy));
  const x = Math.max(0, Math.min(1000 - w, box[1] + dx));
  return [y, x, y + h, x + w];
}

export function resizeBbox(box: Bbox, handle: ResizeHandle, dx: number, dy: number): Bbox {
  let [y0, x0, y1, x1] = clampBbox(box);
  if (handle.includes("n")) y0 = Math.min(y1 - 8, y0 + dy);
  if (handle.includes("s")) y1 = Math.max(y0 + 8, y1 + dy);
  if (handle.includes("w")) x0 = Math.min(x1 - 8, x0 + dx);
  if (handle.includes("e")) x1 = Math.max(x0 + 8, x1 + dx);
  return clampBbox([y0, x0, y1, x1]);
}

// Round only at the pixel boundary, not in normalized editor space.
export function toCentralized(box: Bbox, width: number, height: number): Bbox {
  return [
    Math.round((box[0] / 1000) * height) - height / 2,
    Math.round((box[1] / 1000) * width) - width / 2,
    Math.round((box[2] / 1000) * height) - height / 2,
    Math.round((box[3] / 1000) * width) - width / 2,
  ];
}

export function fromCentralized(box: Bbox, width: number, height: number): Bbox {
  return [
    ((box[0] + height / 2) / height) * 1000,
    ((box[1] + width / 2) / width) * 1000,
    ((box[2] + height / 2) / height) * 1000,
    ((box[3] + width / 2) / width) * 1000,
  ];
}

export function fitImageFrame(aspect: number, width: number, height: number) {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  return w / h > aspect
    ? { x: (w - h * aspect) / 2, y: 0, width: h * aspect, height: h }
    : { x: 0, y: (h - w / aspect) / 2, width: w, height: w / aspect };
}
