from server import PromptServer

# Comfy creates the PromptServer instance at startup; keep the lookup dynamic for ty.
routes = getattr(getattr(PromptServer, "instance"), "routes")  # noqa: B009
