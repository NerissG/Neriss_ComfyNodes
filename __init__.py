import os

from .nodes import NerissComfyNodesExtension

WEB_DIRECTORY = "./web/dev" if os.environ.get("WEB_DEV") == "1" else "./web/dist"


async def comfy_entrypoint() -> NerissComfyNodesExtension:
    return NerissComfyNodesExtension()


__all__ = ["WEB_DIRECTORY", "comfy_entrypoint"]
