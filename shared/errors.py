from __future__ import annotations

from dataclasses import dataclass
from typing import Generic, Literal, TypeAlias, TypeVar

ErrorCode = TypeVar("ErrorCode", bound=str)


@dataclass(frozen=True, slots=True)
class AppErrorPayload(Generic[ErrorCode]):
    code: ErrorCode
    message: str
    details: dict[str, object] | None = None
    cause: object | None = None


class BaseAppError(Exception, Generic[ErrorCode]):
    code: ErrorCode
    details: dict[str, object] | None
    cause: object | None

    def __init__(self, name: str, payload: AppErrorPayload[ErrorCode]) -> None:
        super().__init__(payload.message)
        self.name = name
        self.code = payload.code
        self.details = payload.details
        self.cause = payload.cause


class EditorError(BaseAppError[Literal["EDITOR_ERROR"]]):
    def __init__(self, payload: AppErrorPayload[Literal["EDITOR_ERROR"]]) -> None:
        super().__init__("EditorError", payload)


class ComfyError(BaseAppError[Literal["COMFY_ERROR"]]):
    def __init__(self, payload: AppErrorPayload[Literal["COMFY_ERROR"]]) -> None:
        super().__init__("ComfyError", payload)


AppError: TypeAlias = EditorError | ComfyError


class EditorErrors:
    @staticmethod
    def runtime(
        message: str,
        details: dict[str, object] | None = None,
        cause: object | None = None,
    ) -> EditorError:
        return EditorError(
            AppErrorPayload(
                code="EDITOR_ERROR",
                message=message,
                details=details,
                cause=cause,
            )
        )


class ComfyErrors:
    @staticmethod
    def runtime(
        message: str,
        details: dict[str, object] | None = None,
        cause: object | None = None,
    ) -> ComfyError:
        return ComfyError(
            AppErrorPayload(
                code="COMFY_ERROR",
                message=message,
                details=details,
                cause=cause,
            )
        )


editor_errors = EditorErrors()
comfy_errors = ComfyErrors()
