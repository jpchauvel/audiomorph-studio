# Plan: ML Model Storage & Download Progress IPC

## Storage Strategy

**Use the standard HF Hub cache at `~/.cache/huggingface/hub`.**

Do NOT store models in `app.getPath('userData')`. Reasons:
- Models downloaded by the app are immediately usable by other HF tools
- Content-addressed blobs = no duplication across model versions
- Users can manage disk space with `huggingface-cli cache scan/delete`
- Consistent with user expectations for ML tooling

### Override Support

Respect HF environment variables (users may have custom cache locations):

```typescript
// electron/main.ts — pass to sidecar process env
function getHFEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  // Pass through user's HF env vars if set
  if (process.env.HF_HOME) env.HF_HOME = process.env.HF_HOME
  if (process.env.HF_HUB_CACHE) env.HF_HUB_CACHE = process.env.HF_HUB_CACHE
  if (process.env.HF_TOKEN) env.HF_TOKEN = process.env.HF_TOKEN
  return env
}

// In startSidecar():
sidecarProcess = spawn(python, [script, '--port', String(port)], {
  env: { ...process.env, PYTHONUNBUFFERED: '1', ...getHFEnv() },
})
```

### Settings UI: Custom Cache Location

Allow users to override the cache directory from Settings:

```typescript
// electron/ipc.ts
ipcMain.handle('settings:get-model-cache-dir', () => {
  return store.get('modelCacheDir') || getDefaultHFCacheDir()
})

ipcMain.handle('settings:set-model-cache-dir', async (_, dir: string) => {
  store.set('modelCacheDir', dir)
  // Restart sidecar with new HF_HUB_CACHE env
  await restartSidecar({ HF_HUB_CACHE: dir })
})
```

---

## Model Download: FastAPI SSE Endpoint

```python
# backend/api/models.py
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from huggingface_hub import snapshot_download, hf_hub_download, HfFileSystem
import json, asyncio, os

router = APIRouter()

@router.get("/list")
async def list_cached_models():
    """List models already in the HF cache."""
    from huggingface_hub import scan_cache_dir
    cache_info = scan_cache_dir()
    return [
        {
            "repoId": repo.repo_id,
            "repoType": repo.repo_type,
            "sizeOnDisk": repo.size_on_disk,
            "lastAccessed": repo.last_accessed,
            "revisions": [r.commit_hash[:8] for r in repo.revisions],
        }
        for repo in cache_info.repos
    ]

@router.get("/download/{repo_id:path}")
async def download_model(repo_id: str, revision: str = "main"):
    """SSE stream: download a model from HF Hub."""

    async def stream():
        loop = asyncio.get_event_loop()
        queue: asyncio.Queue = asyncio.Queue()

        def on_progress(filename: str, downloaded: int, total: int):
            percent = round(downloaded / total * 100, 1) if total else 0
            loop.call_soon_threadsafe(queue.put_nowait, {
                "event": "progress",
                "filename": filename,
                "downloaded": downloaded,
                "total": total,
                "percent": percent,
            })

        async def run_download():
            try:
                # Use snapshot_download for full model repos
                # Filter to safetensors only — skip legacy .bin weights
                path = await loop.run_in_executor(None, lambda: snapshot_download(
                    repo_id=repo_id,
                    revision=revision,
                    allow_patterns=["*.safetensors", "*.json", "*.txt", "*.model", "tokenizer*"],
                    ignore_patterns=["*.bin", "flax_*", "tf_*", "onnx/*"],
                ))
                await queue.put({"event": "complete", "localPath": path})
            except Exception as e:
                await queue.put({"event": "error", "message": str(e)})

        asyncio.create_task(run_download())

        while True:
            item = await asyncio.wait_for(queue.get(), timeout=300)
            yield f"data: {json.dumps(item)}\n\n"
            if item["event"] in ("complete", "error"):
                break

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache"})

@router.delete("/cache/{repo_id:path}")
async def delete_model(repo_id: str):
    """Delete a model from the HF cache."""
    from huggingface_hub import scan_cache_dir
    cache_info = scan_cache_dir()
    delete_strategy = cache_info.delete_revisions(
        *[rev.commit_hash for repo in cache_info.repos
          if repo.repo_id == repo_id
          for rev in repo.revisions]
    )
    delete_strategy.execute()
    return {"deleted": repo_id, "freedBytes": delete_strategy.expected_freed_size}
```

---

## IPC: Download Progress to Renderer

The renderer subscribes to download progress via the preload bridge. The main process forwards SSE events from the FastAPI sidecar over IPC:

```typescript
// electron/download-manager.ts
import { BrowserWindow } from 'electron'
import { getSidecarPort } from './sidecar'

export async function startModelDownload(
  win: BrowserWindow,
  repoId: string
): Promise<void> {
  const port = getSidecarPort()!
  const url = `http://127.0.0.1:${port}/api/models/download/${encodeURIComponent(repoId)}`

  const response = await fetch(url)
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const text = decoder.decode(value)
    for (const line of text.split('\n')) {
      if (!line.startsWith('data: ')) continue
      try {
        const data = JSON.parse(line.slice(6))
        // Forward to renderer via IPC
        win.webContents.send('download:progress', { repoId, ...data })
      } catch { /* skip malformed */ }
    }
  }
}
```

```typescript
// electron/ipc.ts — register handler
ipcMain.handle('models:download', async (event, repoId: string) => {
  const win = BrowserWindow.fromWebContents(event.sender)!
  await startModelDownload(win, repoId)
})
```

```typescript
// frontend — React hook
function useModelDownload(repoId: string) {
  const [progress, setProgress] = useState<DownloadProgress | null>(null)

  const startDownload = useCallback(async () => {
    // Subscribe to progress events BEFORE starting download
    const unsubscribe = window.electronAPI.onDownloadProgress((p) => {
      if (p.modelId === repoId) setProgress(p)
    })

    try {
      await window.electronAPI.downloadModel(repoId)
    } finally {
      unsubscribe()
    }
  }, [repoId])

  return { progress, startDownload }
}
```

---

## Disk Space Check Before Download

```python
# backend/api/models.py — add to download endpoint
@router.get("/download-info/{repo_id:path}")
async def get_download_info(repo_id: str):
    """Get model size before downloading."""
    from huggingface_hub import HfApi
    api = HfApi()
    info = api.model_info(repo_id, files_metadata=True)
    total_size = sum(
        f.size for f in (info.siblings or [])
        if f.rfilename.endswith(('.safetensors', '.json', '.txt'))
        and not f.rfilename.startswith(('flax_', 'tf_'))
    )
    return {"repoId": repo_id, "estimatedBytes": total_size}
```

Show estimated download size in the UI before the user confirms the download.

---

## Model Registry (app-defined models)

Define the models the app supports in a registry file:

```typescript
// shared/model-registry.ts
export interface ModelDefinition {
  id: string
  repoId: string          // HF repo ID
  displayName: string
  description: string
  sizeBytes: number       // Approximate
  tags: string[]
  required: boolean       // If true, must be downloaded before app is usable
}

export const MODEL_REGISTRY: ModelDefinition[] = [
  {
    id: 'whisper-large-v3',
    repoId: 'openai/whisper-large-v3',
    displayName: 'Whisper Large v3',
    description: 'High-accuracy speech recognition',
    sizeBytes: 3_100_000_000,
    tags: ['transcription', 'speech'],
    required: false,
  },
  // ... add your models
]
```

---

## Open Questions / Decisions Needed

- [ ] **HF token**: How does the user provide their HF token for gated models? Settings UI → stored in OS keychain via `keytar`?
- [ ] **Concurrent downloads**: Allow multiple simultaneous model downloads, or queue them?
- [ ] **Model updates**: Check for newer revisions of cached models? How often?
- [ ] **Storage quota warning**: Warn user when HF cache exceeds a configurable threshold (e.g., 50GB)?
