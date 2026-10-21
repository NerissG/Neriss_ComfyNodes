/// <reference types="vite/client" />

// Chromium-only EyeDropper API, not yet in TypeScript's DOM lib.
interface Window {
  EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> };
}
