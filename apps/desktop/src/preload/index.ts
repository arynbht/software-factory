// The preload bridge: the ONLY surface the renderer can reach. It exposes a
// typed, allow-listed API over contextBridge; the renderer never touches
// ipcRenderer, fs, git, or the network. Every request is zod-validated before it
// leaves and every response is zod-validated before the renderer sees it.
import { contextBridge, ipcRenderer } from "electron";

import { IpcChannel, PingRequest, PingResponse } from "../shared/ipc";

const api = {
  /** Smoke round-trip: validate the request, invoke main, validate the reply. */
  async ping(message: string): Promise<PingResponse> {
    const request = PingRequest.parse({ message });
    const raw: unknown = await ipcRenderer.invoke(IpcChannel.Ping, request);
    return PingResponse.parse(raw);
  },
};

/** The shape exposed as `window.factory` in the renderer. */
export type FactoryApi = typeof api;

contextBridge.exposeInMainWorld("factory", api);
