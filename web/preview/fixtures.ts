import { createInitialState, type EditorRegion, type EditorState } from "@/editor/state";

const elements: EditorRegion[] = [
  {
    id: "window",
    type: "obj",
    label: "object",
    desc: "Bookshop window with warm amber lighting and stacked books",
    text: "",
    bbox: [100, 100, 400, 440],
    color_palette: [],
  },
  {
    id: "reader",
    type: "obj",
    label: "character",
    desc: "A reader in a long blue coat, holding an open book",
    text: "",
    bbox: [360, 400, 800, 750],
    color_palette: [],
  },
  {
    id: "cat",
    type: "obj",
    label: "character",
    desc: "Small sleeping cat curled on the windowsill",
    text: "",
    bbox: [250, 150, 360, 380],
    color_palette: [],
  },
  {
    id: "lamp",
    type: "obj",
    label: "object",
    desc: "Hanging brass lamp with a warm pool of light",
    text: "",
    bbox: [80, 500, 280, 720],
    color_palette: [],
  },
  {
    id: "sign",
    type: "text",
    label: "text",
    desc: "Hand-painted cream lettering on a dark green sign",
    text: "The Reading Room",
    bbox: [30, 100, 90, 800],
    color_palette: ["#F5E8C8"],
  },
  {
    id: "pavement",
    type: "obj",
    label: "object",
    desc: "Rain-washed pavement reflecting the window",
    text: "",
    bbox: [800, 20, 950, 980],
    color_palette: [],
  },
  {
    id: "fern",
    type: "obj",
    label: "object",
    desc: "Potted fern beside the entrance",
    text: "",
    bbox: [590, 30, 790, 220],
    color_palette: [],
  },
  {
    id: "bicycle",
    type: "obj",
    label: "object",
    desc: "Bicycle leaning against the wall",
    text: "",
    bbox: [500, 680, 850, 980],
    color_palette: [],
  },
  {
    id: "bag",
    type: "obj",
    label: "object",
    desc: "Paper shopping bag with books",
    text: "",
    bbox: [740, 420, 880, 560],
    color_palette: [],
  },
];

export function previewState(empty = false): EditorState {
  return {
    ...createInitialState(),
    width: 1024,
    height: 1472,
    megapixels: 1.507328,
    high_level_description:
      "A quiet bookshop at dusk, warm amber light spilling onto a rain-soaked street. Hand-painted editorial illustration with textured paper and muted colors.",
    elements: empty ? [] : structuredClone(elements),
    selected_region_id: empty ? null : "reader",
  };
}
