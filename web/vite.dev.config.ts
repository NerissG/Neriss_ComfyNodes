import { fileURLToPath } from "node:url";
import process from "node:process";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { z } from "zod";

export default defineConfig(() => {
  const origin = z.url({ protocol: /^https?$/ }).safeParse(process.env.COMFY_ORIGIN ?? "http://127.0.0.1:8188");
  if (!origin.success) {
    console.error("COMFY_ORIGIN must be the HTTP(S) URL used to open ComfyUI, e.g. http://127.0.0.1:8188.");
    process.exit(1);
  }

  return {
    plugins: [svelte()],
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      origin: "http://127.0.0.1:5173",
      cors: { origin: new URL(origin.data).origin },
    },
    optimizeDeps: { entries: ["src/extension.ts"] },
  };
});
