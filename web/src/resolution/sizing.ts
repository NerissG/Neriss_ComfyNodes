// Match Python's round() at exact half multiples, including very small canvases.
function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  return value - floor === 0.5 ? floor + (floor % 2) : Math.round(value);
}

export function calculateResolution(aspectX: number, aspectY: number, targetPixels: number, multiple: number) {
  const ratio = aspectX / aspectY;
  const rawWidth = Math.sqrt(targetPixels * ratio);
  const rawHeight = rawWidth / ratio;
  const snap = (value: number) => Math.max(multiple, roundHalfEven(value / multiple) * multiple);
  return { width: snap(rawWidth), height: snap(rawHeight) };
}
