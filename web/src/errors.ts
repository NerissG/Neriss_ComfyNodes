export type AppErrorPayload<TCode extends string = string> = {
  code: TCode;
  message: string;
  details?: Record<string, unknown>;
  cause?: unknown;
};

class BaseAppError<TCode extends string = string> extends Error {
  readonly code: TCode;
  readonly details?: Record<string, unknown>;
  readonly cause?: unknown;

  constructor(name: string, payload: AppErrorPayload<TCode>) {
    super(payload.message);
    this.name = name;
    this.code = payload.code;
    this.details = payload.details;
    this.cause = payload.cause;
  }
}

export type EditorErrorCode = "EDITOR_ERROR";

export class EditorError extends BaseAppError<EditorErrorCode> {
  constructor(payload: AppErrorPayload<EditorErrorCode>) {
    super("EditorError", payload);
  }
}

export type ComfyErrorCode = "COMFY_ERROR";

export class ComfyError extends BaseAppError<ComfyErrorCode> {
  constructor(payload: AppErrorPayload<ComfyErrorCode>) {
    super("ComfyError", payload);
  }
}

export type AppError = EditorError | ComfyError;

export const editorErrors = {
  runtime: (message: string, details?: Record<string, unknown>, cause?: unknown) =>
    new EditorError({
      code: "EDITOR_ERROR",
      message,
      details,
      cause,
    }),
};

export const comfyErrors = {
  runtime: (message: string, details?: Record<string, unknown>, cause?: unknown) =>
    new ComfyError({
      code: "COMFY_ERROR",
      message,
      details,
      cause,
    }),
};

export function formatAppError(error: AppError): string {
  return error.message;
}
