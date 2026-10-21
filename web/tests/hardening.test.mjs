import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import { URL } from "node:url";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: "custom" });
after(() => server.close());
const { createInitialState, parseEditorState, encodeEditorState } = await server.ssrLoadModule("/src/editor/state.ts");
const { importIdeogramText } = await server.ssrLoadModule("/src/ideogram/prompt.ts");
const { importMossText } = await server.ssrLoadModule("/src/moss/prompt.ts");
const { parseBoundedJson } = await server.ssrLoadModule("/src/editor/limits.ts");
const { fetchLibrary, configureComfyApi, comfyUrl } = await server.ssrLoadModule("/src/comfy/api.ts");
const { saveResolutionPresets } = await server.ssrLoadModule("/src/resolution/presets.ts");
const cases = JSON.parse(
  await readFile(new URL("../../tests/fixtures/hardening_validation.json", import.meta.url), "utf8"),
);

test("shared malformed state and prompt fixtures agree with Python validation", () => {
  for (const item of cases) {
    const text = JSON.stringify(item.value);
    const parsed =
      item.kind === "state"
        ? parseEditorState(text)
        : item.kind === "ideogram"
          ? importIdeogramText(createInitialState(), text, "all")
          : importMossText(createInitialState(), text);
    assert.equal(parsed.isOk(), item.valid, item.name);
  }
});

test("JSON and saved-state byte limits also reject multibyte and deeply nested payloads safely", () => {
  assert.equal(parseBoundedJson(" ".repeat(2 * 1024 * 1024 + 1)).isErr(), true);
  assert.equal(parseBoundedJson(JSON.stringify("é".repeat(1024 * 1024))).isErr(), true);
  assert.equal(parseEditorState("[".repeat(2000) + "]".repeat(2000)).isErr(), true);
  const state = createInitialState();
  state.elements = Array.from({ length: 40 }, (_, index) => ({
    id: `region-${index}`,
    type: "obj",
    bbox: null,
    desc: "a".repeat(65_536),
    text: "",
    color_palette: [],
  }));
  assert.equal(encodeEditorState(state).isErr(), true);
  assert.equal(
    parseEditorState(JSON.stringify({ ...state, high_level_description: "a".repeat(65_537) })).isErr(),
    true,
  );
});

test("collection and text limits reject oversized editor documents", () => {
  for (const patch of [
    { moss_meta: Array(257).fill("tag") },
    { high_level_description: "a".repeat(65_537) },
    { elements: Array.from({ length: 2049 }, (_, index) => ({ id: `r-${index}`, type: "obj" })) },
  ])
    assert.equal(parseEditorState(JSON.stringify(patch)).isErr(), true);
});

test("library requests preserve ETags, configured Comfy transport and conflict status", async () => {
  const requests = [];
  configureComfyApi({
    fetchApi: async (route, options) => {
      requests.push({ route, options });
      return options?.method === "POST"
        ? globalThis.Response.json({ error: "Reload before saving" }, { status: 409 })
        : globalThis.Response.json({ presets: [{ name: "Square", x: 1, y: 1 }] }, { headers: { ETag: '"first"' } });
    },
  });
  const endpoint = "/neriss_comfynodes/resolution/presets";
  await fetchLibrary(endpoint);
  const result = await saveResolutionPresets([{ name: "Portrait", x: 9, y: 16 }]);
  assert.equal(result.isErr(), true);
  assert.equal(result.error.details.status, 409);
  assert.equal(requests[1].route, endpoint);
  const headers = new globalThis.Headers(requests[1].options.headers);
  assert.equal(headers.get("If-Match"), '"first"');
  assert.equal(headers.get("Content-Type"), "application/json");
});

test("reference URLs retain a path-prefixed page base", (context) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { baseURI: "https://example.test/comfy/" },
  });
  context.after(() => {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else delete globalThis.document;
  });
  assert.equal(
    comfyUrl("/neriss_comfynodes/editor/reference_image"),
    "/comfy/neriss_comfynodes/editor/reference_image",
  );
});
