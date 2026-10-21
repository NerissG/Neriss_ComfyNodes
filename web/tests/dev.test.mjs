import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { after, test } from "node:test";
import { fileURLToPath, URL } from "node:url";
import { createServer } from "vite";

const server = await createServer({
  configFile: "vite.dev.config.ts",
  // This config differs from the SSR unit tests running in parallel. Never
  // invalidate their prebundled dependencies (or a running dev server's cache).
  cacheDir: "node_modules/.vite/dev-tests",
  server: { middlewareMode: true, ws: false },
  appType: "custom",
});
after(() => server.close());

test("embedded development is loopback-only with a fixed port and explicit ComfyUI CORS", () => {
  assert.equal(server.config.server.host, "127.0.0.1");
  assert.equal(server.config.server.port, 5173);
  assert.equal(server.config.server.strictPort, true);
  assert.equal(server.config.server.origin, "http://127.0.0.1:5173");
  assert.deepEqual(server.config.server.cors, {
    origin: new URL(process.env.COMFY_ORIGIN ?? "http://127.0.0.1:8188").origin,
  });
  assert.deepEqual(server.config.optimizeDeps.entries, ["src/extension.ts"]);
});

test("ComfyUI's loader awaits the HMR client and extension before returning", async () => {
  const loader = await readFile(new URL("../dev/loader.js", import.meta.url), "utf8");
  assert.match(
    loader,
    /await import\("http:\/\/127\.0\.0\.1:5173\/@vite\/client"\);\s*await import\("http:\/\/127\.0\.0\.1:5173\/src\/extension\.ts"\);/,
  );
});

test(
  "Svelte and CSS accept HMR while extension registration forces a page reload",
  { timeout: 10_000 },
  async (context) => {
    await server.transformRequest("/src/extension.ts");
    await server.transformRequest("/src/App.svelte");
    await server.transformRequest("/src/editor/theme.css");
    const graph = server.environments.client.moduleGraph;
    assert.equal((await graph.getModuleByUrl("/src/extension.ts")).isSelfAccepting, false);
    assert.equal((await graph.getModuleByUrl("/src/App.svelte")).isSelfAccepting, true);
    assert.equal((await graph.getModuleByUrl("/src/editor/theme.css")).isSelfAccepting, true);

    async function change(path) {
      const payload = new Promise((resolve) => {
        context.mock.method(server.environments.client.hot, "send", resolve);
      });
      // Exercise Vite's watcher without modifying source files on disk.
      server.watcher.emit("change", fileURLToPath(new URL(path, import.meta.url)));
      const result = await payload;
      context.mock.restoreAll();
      return result;
    }

    const styleUpdate = await change("../src/editor/theme.css");
    assert.equal(styleUpdate.type, "update");
    assert.equal(styleUpdate.updates[0].path, "/src/editor/theme.css");
    assert.equal((await change("../src/extension.ts")).type, "full-reload");
  },
);
