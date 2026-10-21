import { ResultAsync, err, errAsync, ok } from "neverthrow";
import { get, writable } from "svelte/store";
import { z } from "zod";
import { comfyErrors, formatAppError, type AppError } from "@/errors";
import { hexColorSchema } from "./geometry";
import { fetchLibrary } from "@/comfy/api";

export type Hsv = { h: number; s: number; v: number };

/** Accepts pasted forms such as `#b99b63`, `B99B63`, `#abc`, `166, 73, 63` or `rgb(166 73 63)`. */
export function parseColor(text: string): string | null {
  const rgb = /^(?:rgb\(\s*)?(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})\s*\)?$/i.exec(text.trim());
  if (rgb) {
    const channels = rgb.slice(1).map(Number);
    if (channels.some((channel) => channel > 255)) return null;
    return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
  }
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim());
  if (!hex) return null;
  const digits = hex[1].length === 3 ? [...hex[1]].map((digit) => digit + digit).join("") : hex[1];
  return `#${digits.toUpperCase()}`;
}

export function hexToHsv(hex: string): Hsv {
  const [r, g, b] = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  const h = !delta ? 0 : max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return { h: (h * 60 + 360) % 360, s: max ? delta / max : 0, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const channel = (n: number) => {
    const k = (n + h / 60) % 6;
    const value = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(5)}${channel(3)}${channel(1)}`.toUpperCase();
}

const colorLibrarySchema = z.object({
  favorites: z.array(hexColorSchema).max(1024),
  recent: z.array(hexColorSchema).max(1024),
});
export type ColorLibrary = z.infer<typeof colorLibrarySchema>;

const endpoint = "/neriss_comfynodes/editor/colors";
const recentLimit = 12;
let loaded = false;
let pending: ResultAsync<ColorLibrary, AppError> | null = null;
let queue = Promise.resolve();
export const colorLibrary = writable<ColorLibrary>({ favorites: [], recent: [] });
export const colorLibraryError = writable<string | null>(null);

function request(init?: RequestInit): ResultAsync<ColorLibrary, AppError> {
  return ResultAsync.fromPromise(fetchLibrary(endpoint, init), (cause) =>
    comfyErrors.runtime("Could not reach the color library", undefined, cause),
  )
    .andThen((response) =>
      response.ok
        ? ResultAsync.fromPromise(response.json(), (cause) =>
            comfyErrors.runtime("Could not read the color library", undefined, cause),
          )
        : errAsync(comfyErrors.runtime(`Color library request failed: ${response.statusText}`)),
    )
    .andThen((payload) => {
      const parsed = colorLibrarySchema.safeParse(payload);
      return parsed.success
        ? ok(parsed.data)
        : err(comfyErrors.runtime("Color library is invalid", { issues: parsed.error.issues }));
    });
}

function ensureLoaded(): ResultAsync<ColorLibrary, AppError> {
  if (loaded) return ResultAsync.fromSafePromise(Promise.resolve(get(colorLibrary)));
  if (pending) return pending;
  pending = request()
    .map((library) => {
      colorLibrary.set(library);
      loaded = true;
      pending = null;
      return library;
    })
    .mapErr((error) => {
      pending = null;
      colorLibraryError.set(formatAppError(error));
      return error;
    });
  return pending;
}

export function loadColorLibrary() {
  void ensureLoaded();
}

function save(update: (library: ColorLibrary) => ColorLibrary) {
  queue = queue.then(async () => {
    const loadedLibrary = await ensureLoaded();
    if (loadedLibrary.isErr()) return;
    const result = await request({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update(get(colorLibrary))),
    });
    if (result.isOk()) {
      colorLibrary.set(result.value);
      colorLibraryError.set(null);
    } else {
      loaded = false;
      colorLibraryError.set(formatAppError(result.error));
    }
  });
}

export function rememberColor(color: string) {
  save((library) => ({
    ...library,
    recent: [color, ...library.recent.filter((item) => item !== color)].slice(0, recentLimit),
  }));
}

export function toggleFavorite(color: string) {
  save(({ favorites, recent }) => ({
    recent,
    favorites: favorites.includes(color) ? favorites.filter((item) => item !== color) : [...favorites, color],
  }));
}
