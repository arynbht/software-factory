// The preload bridge: the ONLY surface the renderer can reach. It exposes a
// typed, allow-listed API over contextBridge; the renderer never touches
// ipcRenderer, fs, git, or the network. Every request is zod-validated before it
// leaves and every response is zod-validated before the renderer sees it.
import { contextBridge, ipcRenderer } from "electron";

import {
  AuditRunRequest,
  IpcChannel,
  PingRequest,
  PingResponse,
  RepoList,
  RepoRemoveRequest,
  Scorecard,
} from "../shared/ipc";

const api = {
  /** Smoke round-trip: validate the request, invoke main, validate the reply. */
  async ping(message: string) {
    const request = PingRequest.parse({ message });
    const raw: unknown = await ipcRenderer.invoke(IpcChannel.Ping, request);
    return PingResponse.parse(raw);
  },

  repos: {
    async list() {
      const raw: unknown = await ipcRenderer.invoke(IpcChannel.ReposList);
      return RepoList.parse(raw);
    },
    /** Opens a native folder picker in main; returns the updated list. */
    async add() {
      const raw: unknown = await ipcRenderer.invoke(IpcChannel.ReposAdd);
      return RepoList.parse(raw);
    },
    async remove(path: string) {
      const request = RepoRemoveRequest.parse({ path });
      const raw: unknown = await ipcRenderer.invoke(
        IpcChannel.ReposRemove,
        request,
      );
      return RepoList.parse(raw);
    },
  },

  audit: {
    async run(repoPath: string) {
      const request = AuditRunRequest.parse({ repoPath });
      const raw: unknown = await ipcRenderer.invoke(
        IpcChannel.AuditRun,
        request,
      );
      return Scorecard.parse(raw);
    },
  },
};

/** The shape exposed as `window.factory` in the renderer. */
export type FactoryApi = typeof api;

contextBridge.exposeInMainWorld("factory", api);
