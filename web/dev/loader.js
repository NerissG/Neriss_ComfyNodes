// ComfyUI awaits extension imports before registering nodes. Keep both imports
// awaited so the development extension participates in that same lifecycle.
await import("http://127.0.0.1:5173/@vite/client");
await import("http://127.0.0.1:5173/src/extension.ts");
