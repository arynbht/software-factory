// The IPC contract shared by main, preload, and renderer. Every channel has a
// zod schema validated on BOTH sides: the main process re-validates each request
// it receives, and the preload re-validates each response before handing it to
// the renderer. The renderer only ever sees the typed `window.factory` surface
// (see preload) — never ipcRenderer, fs, git, or the network directly.
import { z } from "zod";

/** Allow-listed channel names. The preload exposes exactly these. */
export const IpcChannel = {
  Ping: "app:ping",
} as const;

export type IpcChannelName = (typeof IpcChannel)[keyof typeof IpcChannel];

// app:ping — a smoke round-trip proving the typed, validated bridge works.
export const PingRequest = z.object({
  message: z.string().min(1).max(200),
});
export type PingRequest = z.infer<typeof PingRequest>;

export const PingResponse = z.object({
  reply: z.string(),
  /** The main process's app version, so the renderer can see who answered. */
  version: z.string(),
});
export type PingResponse = z.infer<typeof PingResponse>;
