import { z } from "zod";

type ComfyApi = { fetchApi(route: string, options?: RequestInit): Promise<Response> };
const apiSchema = z.custom<ComfyApi>(
  (value) => typeof value === "object" && value !== null && "fetchApi" in value && typeof value.fetchApi === "function",
);
let api: ComfyApi | null = null;
const revisions = new Map<string, string>();
const generations = new Map<string, number>();

export function configureComfyApi(value: unknown) {
  const parsed = apiSchema.safeParse(value);
  if (parsed.success) api = parsed.data;
}

export function comfyUrl(route: string): string {
  const base = typeof document === "undefined" ? "http://localhost/" : document.baseURI;
  const url = new URL(route.replace(/^\//, ""), base);
  return `${url.pathname}${url.search}`;
}

export function fetchComfy(route: string, options?: RequestInit): Promise<Response> {
  return api ? api.fetchApi(route, options) : fetch(comfyUrl(route), options);
}

export async function fetchLibrary(route: string, options?: RequestInit): Promise<Response> {
  const headers = new Headers(options?.headers);
  const writing = options?.method === "POST";
  const generation = (generations.get(route) ?? 0) + (writing ? 1 : 0);
  if (writing) {
    generations.set(route, generation);
    const revision = revisions.get(route);
    if (revision) headers.set("If-Match", revision);
  }
  const response = await fetchComfy(route, { ...options, headers });
  const revision = response.headers.get("ETag");
  if (response.ok && revision && generation === (generations.get(route) ?? 0)) revisions.set(route, revision);
  return response;
}
