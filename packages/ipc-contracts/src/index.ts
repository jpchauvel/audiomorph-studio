export interface ApiRequestInput {
  method: string;
  path: string;
  body?: unknown;
  requestId?: string;
}

export interface ApiRequestOutput {
  status: number;
  body: unknown;
}

export interface ApiCancelInput {
  requestId: string;
}

export interface ApiFetchAudioInput {
  jobId: string;
}

export interface ApiFetchAudioOutput {
  bytes: Uint8Array;
  contentType: string;
}

export interface ApiStreamInput {
  streamId: string;
  path: string;
  body?: unknown;
}

export interface ApiStreamCancelInput {
  streamId: string;
}

export interface ApiStreamEventPayload {
  streamId: string;
  event: string;
  data: unknown;
}

export interface ApiStreamEndPayload {
  streamId: string;
}

export interface ApiStreamErrorPayload {
  streamId: string;
  error: {
    code: string;
    message: string;
    hint?: string;
  };
}

export interface HardwareFailure {
  requirement: string;
  actual: string;
  message: string;
}

export interface HardwareReport {
  ok: boolean;
  failures: HardwareFailure[];
  details: {
    os: string;
    arch: string;
    gpu: string | null;
    vram_gb: number | null;
    ram_gb: number;
    disk_gb: number;
  };
}

export interface DialogSaveAsInput {
  defaultPath?: string;
  filters?: IpcFileFilter[];
}

export interface DialogSaveAsOutput {
  filePath: string | undefined;
  canceled: boolean;
}

export interface DialogOpenDirectoryInput {
  title?: string;
}

export interface DialogOpenDirectoryOutput {
  dirPath: string | undefined;
  canceled: boolean;
}

export interface DialogOpenFileInput {
  title?: string;
  filters?: IpcFileFilter[];
  multiSelections?: boolean;
}

export interface DialogOpenFileOutput {
  filePaths: string[];
  canceled: boolean;
}

export interface FsCopyFileInput {
  src: string;
  dst: string;
}

export interface FsCopyFileOutput {
  ok: true;
}

export interface FsReadFileInput {
  filePath: string;
  encoding?: 'utf8' | 'base64';
}

export interface FsReadFileOutput {
  data: string;
}

export interface ShellOpenExternalInput {
  url: string;
}

export interface ShellOpenExternalOutput {
  ok: true;
}

export interface ShellShowItemInFolderInput {
  filePath: string;
}

export interface ShellShowItemInFolderOutput {
  ok: true;
}

export interface AppGetVersionOutput {
  version: string;
}

export type AppPathName = 'userData' | 'downloads';

export interface AppGetPathInput {
  name: AppPathName;
}

export interface AppGetPathOutput {
  path: string;
}

export type VaultKey = 'hf_token' | 'openrouter_key';

export interface VaultSetInput {
  key: VaultKey;
  value: string;
}

export interface VaultSetOutput {
  ok: true;
}

export interface VaultGetInput {
  key: VaultKey;
}

export interface VaultGetOutput {
  present: boolean;
}

export interface VaultDeleteInput {
  key: VaultKey;
}

export interface VaultDeleteOutput {
  ok: true;
}

export interface VaultHasInput {
  key: VaultKey;
}

export interface VaultHasOutput {
  present: boolean;
}

export type ApiRequestArgs = ApiRequestInput;
export type ApiResponse = ApiRequestOutput;
export type ApiStreamArgs = ApiStreamInput;
export type StreamEvent = ApiStreamEventPayload;
export type StreamError = ApiStreamErrorPayload['error'];

export type DialogSaveAsArgs = DialogSaveAsInput;
export type DialogSaveAsResult = DialogSaveAsOutput;
export type DialogOpenDirectoryArgs = DialogOpenDirectoryInput;
export type DialogOpenDirectoryResult = DialogOpenDirectoryOutput;
export type DialogOpenFileArgs = DialogOpenFileInput;
export type DialogOpenFileResult = DialogOpenFileOutput;
export type FsCopyFileArgs = FsCopyFileInput;
export type FsReadFileArgs = FsReadFileInput;
export type ApiFetchAudioArgs = ApiFetchAudioInput;
export type ApiFetchAudioResult = ApiFetchAudioOutput;

export interface ElectronAPI {
  request(args: ApiRequestArgs): Promise<ApiResponse>;
  cancel(args: { requestId: string }): Promise<void>;
  stream(
    args: ApiStreamArgs,
    onEvent: (event: StreamEvent) => void,
    onEnd: () => void,
    onError: (error: StreamError) => void,
  ): () => void;
  streamCancel(args: { streamId: string }): Promise<void>;

  fetchAudio(args: ApiFetchAudioInput): Promise<ApiFetchAudioOutput>;

  saveAs(args: DialogSaveAsArgs): Promise<DialogSaveAsResult>;
  openDirectory(args: DialogOpenDirectoryArgs): Promise<DialogOpenDirectoryResult>;
  openFile(args: DialogOpenFileArgs): Promise<DialogOpenFileResult>;

  copyFile(args: FsCopyFileArgs): Promise<{ ok: true }>;
  readFile(args: FsReadFileArgs): Promise<{ data: string }>;

  openExternal(args: { url: string }): Promise<{ ok: true }>;
  showItemInFolder(args: { filePath: string }): Promise<{ ok: true }>;

  getVersion(): Promise<string>;
  getPath(name: AppPathName): Promise<string>;
  hardwareCheck(): Promise<HardwareReport>;

  vault: {
    set(key: VaultKey, value: string): Promise<VaultSetOutput>;
    get(key: VaultKey): Promise<VaultGetOutput>;
    delete(key: VaultKey): Promise<VaultDeleteOutput>;
    has(key: VaultKey): Promise<VaultHasOutput>;
  };
}

export type IpcInvokeMap = {
  'api:request': {
    in: ApiRequestInput;
    out: ApiRequestOutput;
  };
  'api:cancel': {
    in: ApiCancelInput;
    out: { ok: true };
  };
  'api:stream': {
    in: ApiStreamInput;
    out: { ok: true };
  };
  'api:stream:cancel': {
    in: ApiStreamCancelInput;
    out: { ok: true };
  };
  'api:fetchAudio': {
    in: ApiFetchAudioInput;
    out: ApiFetchAudioOutput;
  };
  'dialog:saveAs': {
    in: DialogSaveAsInput;
    out: DialogSaveAsOutput;
  };
  'dialog:openDirectory': {
    in: DialogOpenDirectoryInput;
    out: DialogOpenDirectoryOutput;
  };
  'dialog:openFile': {
    in: DialogOpenFileInput;
    out: DialogOpenFileOutput;
  };
  'fs:copyFile': {
    in: FsCopyFileInput;
    out: FsCopyFileOutput;
  };
  'fs:readFile': {
    in: FsReadFileInput;
    out: FsReadFileOutput;
  };
  'shell:openExternal': {
    in: ShellOpenExternalInput;
    out: ShellOpenExternalOutput;
  };
  'shell:showItemInFolder': {
    in: ShellShowItemInFolderInput;
    out: ShellShowItemInFolderOutput;
  };
  'app:getVersion': {
    in: undefined;
    out: AppGetVersionOutput;
  };
  'app:getPath': {
    in: AppGetPathInput;
    out: AppGetPathOutput;
  };
  'hardware:check': {
    in: undefined;
    out: HardwareReport;
  };
  'vault:set': {
    in: VaultSetInput;
    out: VaultSetOutput;
  };
  'vault:get': {
    in: VaultGetInput;
    out: VaultGetOutput;
  };
  'vault:delete': {
    in: VaultDeleteInput;
    out: VaultDeleteOutput;
  };
  'vault:has': {
    in: VaultHasInput;
    out: VaultHasOutput;
  };
};

export type IpcInvokeChannel = keyof IpcInvokeMap;
export interface IpcFileFilter {
  name: string;
  extensions: string[];
}
