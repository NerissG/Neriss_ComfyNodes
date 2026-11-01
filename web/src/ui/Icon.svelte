<script lang="ts" module>
  const clipboard =
    "M9 5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3M10 2h4a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z";
  const padlock = "M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Z";

  // 24×24 stroke paths; rects and circles are written as path data so each icon is one string.
  const icons = {
    "arrow-down": "M12 5v14m-6-6 6 6 6-6",
    "arrow-up": "M12 19V5m-6 6 6-6 6 6",
    character: "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0",
    clipboard,
    close: "m6 6 12 12M18 6 6 18",
    collapse: "M14 4v6h6M10 20v-6H4M14 10l6-6M10 14l-6 6",
    copy: "M10 8h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2ZM16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3",
    expand: "M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7",
    fit: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
    "invert-selection":
      "M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM20 4 4 20M7 10l2 2 3.5-4",
    keyboard:
      "M5 5h14a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3ZM6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 15h10",
    layout: "M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM9 4v16M9 10h12",
    lock: `${padlock}M8 11V7a4 4 0 0 1 8 0v4`,
    more: "M6 12a1 1 0 1 1-2 0 1 1 0 1 1 2 0ZM13 12a1 1 0 1 1-2 0 1 1 0 1 1 2 0ZM20 12a1 1 0 1 1-2 0 1 1 0 1 1 2 0Z",
    object: "M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM12 8v8M8 12h8",
    palette:
      "M12 3a9 9 0 1 0 0 18h1.5a2.5 2.5 0 0 0 1.8-4.2 1 1 0 0 1 .7-1.8h1a4 4 0 0 0 4-4 8 8 0 0 0-9-8ZM8.25 10a.75.75 0 1 1-1.5 0 .75.75 0 1 1 1.5 0ZM11.75 7a.75.75 0 1 1-1.5 0 .75.75 0 1 1 1.5 0ZM16.25 8.5a.75.75 0 1 1-1.5 0 .75.75 0 1 1 1.5 0Z",
    pan: "M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3",
    paste: `${clipboard}M12 11v7m-3-3 3 3 3-3`,
    pencil: "M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4ZM13.5 6.5l4 4",
    plus: "M12 5v14M5 12h14",
    pointer: "M5 3l6 17 2.5-7 7-2.5Z",
    reset: "M4 10a8 8 0 1 1 1 7M4 4v6h6",
    search: "M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 1 1 13 0ZM16 16l4 4",
    swap: "M4 8h16m-4-4 4 4-4 4M20 16H4m4-4-4 4 4 4",
    "swap-vertical": "M7 4v16m0 0-3-3m3 3 3-3M17 20V4m0 0-3 3m3-3 3 3",
    text: "M5 7V4h14v3M12 4v16M9 20h6",
    trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13M9 7V4h6v3",
    unlock: `${padlock}M8 11V7a4 4 0 0 1 7.7-1.5`,
    upload: "M12 15V3M7 8l5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4",
  } satisfies Record<string, string>;

  export type IconName = keyof typeof icons;
</script>

<script lang="ts">
  let { name, size = 16 }: { name: IconName; size?: number } = $props();
</script>

<svg class="icon" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path d={icons[name]} /></svg>

<style>
  .icon {
    flex: 0 0 auto;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
