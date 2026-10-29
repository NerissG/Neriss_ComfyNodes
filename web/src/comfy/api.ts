import { Result, ResultAsync, err, ok } from "neverthrow";
import { z } from "zod";
import { comfyErrors, type AppError } from "@/errors";

type ComfyApi = { fetchApi(route: string, options?: RequestInit): Promise<Response> };
type Transport = (route: string, options?: RequestInit) => Promise<Response>;
const apiSchema = z.custom<ComfyApi>(
  (value) => typeof value === "object" && value !== null && "fetchApi" in value && typeof value.fetchApi === "function",
);
const errorBodySchema = z.object({ error: z.string() });
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

const parseJson = Result.fromThrowable((text: string): unknown => JSON.parse(text));

export function jsonBody(value: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) };
}

/**
 * Sends a request to a Neriss endpoint and validates its JSON response. Failed responses carry their
 * HTTP status in `details.status` and use the server's `{ error }` message, or the raw body text.
 */
export function requestJson<T>(
  route: string,
  schema: z.ZodType<T>,
  subject: string,
  options?: RequestInit,
  transport: Transport = fetchComfy,
): ResultAsync<T, AppError> {
  return ResultAsync.fromPromise(transport(route, options), (cause) =>
    comfyErrors.runtime(`Could not reach ${subject}`, undefined, cause),
  ).andThen((response) =>
    ResultAsync.fromPromise(response.text(), (cause) =>
      comfyErrors.runtime(`Could not read ${subject}`, { status: response.status }, cause),
    ).andThen((text): Result<T, AppError> => {
      const json = parseJson(text);
      if (!response.ok) {
        const body = errorBodySchema.safeParse(json.unwrapOr(null));
        const message = body.success ? body.data.error : text.trim() || `Request for ${subject} failed`;
        return err(comfyErrors.runtime(message, { status: response.status }));
      }
      const parsed = schema.safeParse(json.unwrapOr(undefined));
      return parsed.success
        ? ok(parsed.data)
        : err(comfyErrors.runtime(`Invalid ${subject} response`, { issues: parsed.error.issues }, parsed.error));
    }),
  );
}
