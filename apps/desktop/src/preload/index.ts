// The preload bridge: the ONLY surface the renderer can reach. It exposes a
// typed, allow-listed API over contextBridge; the renderer never touches
// ipcRenderer, fs, git, or the network. Every request is zod-validated before it
// leaves and every response is zod-validated before the renderer sees it.
import type { Profile } from "@arynbht/factory-catalog";
import { contextBridge, ipcRenderer } from "electron";

import {
  AuditRunRequest,
  AuthStatus,
  AuthUpdate,
  DeviceCodeInfo,
  IpcChannel,
  PingRequest,
  PingResponse,
  ProfileLoadRequest,
  ProfileMeta,
  ProfileSaveRequest,
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

  auth: {
    async status() {
      const raw: unknown = await ipcRenderer.invoke(IpcChannel.AuthStatus);
      return AuthStatus.parse(raw);
    },
    /** Starts the device flow; returns the code to show the user. */
    async signIn() {
      const raw: unknown = await ipcRenderer.invoke(IpcChannel.AuthSignIn);
      return DeviceCodeInfo.parse(raw);
    },
    async signOut() {
      const raw: unknown = await ipcRenderer.invoke(IpcChannel.AuthSignOut);
      return AuthStatus.parse(raw);
    },
    /** Subscribe to the background sign-in outcome; returns an unsubscribe fn. */
    onUpdate(callback: (update: AuthUpdate) => void) {
      const listener = (_event: unknown, payload: unknown): void => {
        callback(AuthUpdate.parse(payload));
      };
      ipcRenderer.on(IpcChannel.AuthUpdate, listener);
      return () => {
        ipcRenderer.removeListener(IpcChannel.AuthUpdate, listener);
      };
    },
  },

  profile: {
    /** The catalog enum lists that drive the form (types, flags, lanes, …). */
    async meta() {
      const raw: unknown = await ipcRenderer.invoke(IpcChannel.ProfileMeta);
      return ProfileMeta.parse(raw);
    },
    /** The repo's profile, or null if it has none. Validated by the engine. */
    async load(repoPath: string): Promise<Profile | null> {
      const request = ProfileLoadRequest.parse({ repoPath });
      const raw: unknown = await ipcRenderer.invoke(
        IpcChannel.ProfileLoad,
        request,
      );
      return raw as Profile | null;
    },
    /** Write the profile with a minimal diff; returns the saved profile. */
    async save(repoPath: string, profile: Profile): Promise<Profile> {
      const request = ProfileSaveRequest.parse({ repoPath, profile });
      const raw: unknown = await ipcRenderer.invoke(
        IpcChannel.ProfileSave,
        request,
      );
      return raw as Profile;
    },
  },
};

/** The shape exposed as `window.factory` in the renderer. */
export type FactoryApi = typeof api;

contextBridge.exposeInMainWorld("factory", api);
