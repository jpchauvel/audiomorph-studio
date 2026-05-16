import { contextBridge, ipcRenderer } from "electron";
import type {
  ApiRequestArgs,
  ApiResponse,
  ApiStreamArgs,
  DialogOpenDirectoryArgs,
  DialogOpenDirectoryResult,
  DialogOpenFileArgs,
  DialogOpenFileResult,
  DialogSaveAsArgs,
  DialogSaveAsResult,
  ElectronAPI,
  FsCopyFileArgs,
  FsReadFileArgs,
  StreamError,
  StreamEvent,
  VaultKey,
} from "@audiomorph/ipc-contracts";

const electronAPI: ElectronAPI = {
  request(args: ApiRequestArgs): Promise<ApiResponse> {
    return ipcRenderer.invoke("api:request", args) as Promise<ApiResponse>;
  },

  async cancel(args: { requestId: string }): Promise<void> {
    await ipcRenderer.invoke("api:cancel", args);
  },

  stream(
    args: ApiStreamArgs,
    onEvent: (event: StreamEvent) => void,
    onEnd: () => void,
    onError: (error: StreamError) => void,
  ): () => void {
    void ipcRenderer.invoke("api:stream", args);

    const onStreamEvent = (_event: unknown, payload: StreamEvent): void => {
      if (payload.streamId !== args.streamId) {
        return;
      }
      onEvent(payload);
    };

    const onStreamEnd = (_event: unknown, payload: { streamId: string }): void => {
      if (payload.streamId !== args.streamId) {
        return;
      }
      onEnd();
    };

    const onStreamError = (
      _event: unknown,
      payload: { streamId: string; error: StreamError },
    ): void => {
      if (payload.streamId !== args.streamId) {
        return;
      }
      onError(payload.error);
    };

    ipcRenderer.on("api:stream:event", onStreamEvent);
    ipcRenderer.on("api:stream:end", onStreamEnd);
    ipcRenderer.on("api:stream:error", onStreamError);

    return () => {
      void ipcRenderer.invoke("api:stream:cancel", { streamId: args.streamId });
      ipcRenderer.removeListener("api:stream:event", onStreamEvent);
      ipcRenderer.removeListener("api:stream:end", onStreamEnd);
      ipcRenderer.removeListener("api:stream:error", onStreamError);
    };
  },

  async streamCancel(args: { streamId: string }): Promise<void> {
    await ipcRenderer.invoke("api:stream:cancel", args);
  },

  saveAs(args: DialogSaveAsArgs): Promise<DialogSaveAsResult> {
    return ipcRenderer.invoke("dialog:saveAs", args) as Promise<DialogSaveAsResult>;
  },

  openDirectory(args: DialogOpenDirectoryArgs): Promise<DialogOpenDirectoryResult> {
    return ipcRenderer.invoke("dialog:openDirectory", args) as Promise<DialogOpenDirectoryResult>;
  },

  openFile(args: DialogOpenFileArgs): Promise<DialogOpenFileResult> {
    return ipcRenderer.invoke("dialog:openFile", args) as Promise<DialogOpenFileResult>;
  },

  copyFile(args: FsCopyFileArgs): Promise<{ ok: true }> {
    return ipcRenderer.invoke("fs:copyFile", args) as Promise<{ ok: true }>;
  },

  readFile(args: FsReadFileArgs): Promise<{ data: string }> {
    return ipcRenderer.invoke("fs:readFile", args) as Promise<{ data: string }>;
  },

  openExternal(args: { url: string }): Promise<{ ok: true }> {
    return ipcRenderer.invoke("shell:openExternal", args) as Promise<{ ok: true }>;
  },

  showItemInFolder(args: { filePath: string }): Promise<{ ok: true }> {
    return ipcRenderer.invoke("shell:showItemInFolder", args) as Promise<{ ok: true }>;
  },

  async getVersion(): Promise<string> {
    const result = (await ipcRenderer.invoke("app:getVersion")) as { version: string };
    return result.version;
  },

  async getPath(name: "userData" | "downloads"): Promise<string> {
    const result = (await ipcRenderer.invoke("app:getPath", { name })) as { path: string };
    return result.path;
  },

  hardwareCheck() {
    return ipcRenderer.invoke("hardware:check");
  },

  vault: {
    set(key: VaultKey, value: string): Promise<{ ok: true }> {
      return ipcRenderer.invoke("vault:set", { key, value }) as Promise<{ ok: true }>;
    },
    get(key: VaultKey): Promise<{ present: boolean }> {
      return ipcRenderer.invoke("vault:get", { key }) as Promise<{ present: boolean }>;
    },
    delete(key: VaultKey): Promise<{ ok: true }> {
      return ipcRenderer.invoke("vault:delete", { key }) as Promise<{ ok: true }>;
    },
    has(key: VaultKey): Promise<{ present: boolean }> {
      return ipcRenderer.invoke("vault:has", { key }) as Promise<{ present: boolean }>;
    },
  },
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
