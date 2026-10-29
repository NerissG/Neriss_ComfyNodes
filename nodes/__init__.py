"""Custom node modules for Neriss ComfyNodes."""

from comfy_api.latest import ComfyExtension, io

from .image_editor import NerissIdeogramV4PromptEditor
from .image_resize_megapixels import NerissScaleImageToMegapixels
from .lora_strength_editor import NerissLoraBlockStrengthEditor
from .moss_prompt_editor import NerissMossLayoutPromptEditor
from .resolution_selector import NerissResolutionSelector


class NerissComfyNodesExtension(ComfyExtension):
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return [
            NerissIdeogramV4PromptEditor,
            NerissMossLayoutPromptEditor,
            NerissResolutionSelector,
            NerissScaleImageToMegapixels,
            NerissLoraBlockStrengthEditor,
        ]
