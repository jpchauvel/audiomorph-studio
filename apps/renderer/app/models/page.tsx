'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NumberTicker } from '@/components/magicui/number-ticker';
import {
  useModelsStore,
  ModelInfo,
  DownloadProgress as _DownloadProgress,
} from '@/lib/stores/models';
type StreamError = { code: string; message: string };

const errMessage = (e: unknown): string =>
  e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e);

// FastAPI {model_id} path params reject '/'. Sidecar manager decodes '__'→'/'.
const encodeModelId = (id: string): string => id.replace(/\//g, '__');

export default function ModelsPage() {
  const {
    models,
    progress,
    setModels,
    setProgress,
    clearProgress: _clearProgress,
  } = useModelsStore();
  const [activeDownloads, setActiveDownloads] = useState<
    Record<string, { dispose: () => void; jobId: string }>
  >({});
  const [hfDialogOpen, setHfDialogOpen] = useState(false);
  const [hfTokenInput, setHfTokenInput] = useState('');
  const [hfSaving, setHfSaving] = useState(false);
  const [hfTokenPresent, setHfTokenPresent] = useState(false);

  const refreshHfTokenPresent = async () => {
    try {
      const res = await window.electronAPI.request({
        method: 'GET',
        path: '/settings/hf_token_present',
      });
      if (res.status < 200 || res.status >= 300) return;
      const body = res.body as { value?: string } | null;
      setHfTokenPresent(body?.value === 'true');
    } catch {
      setHfTokenPresent(false);
    }
  };

  const signOutHf = async () => {
    try {
      await window.electronAPI.vault.delete('hf_token');
      await window.electronAPI.request({
        method: 'PUT',
        path: '/settings/hf_token_present',
        body: { value: 'false' },
      });
      setHfTokenPresent(false);
      setHfDialogOpen(false);
      toast.success('HuggingFace signed out');
    } catch (e: unknown) {
      toast.error('Failed to sign out: ' + errMessage(e));
    }
  };

  const saveHfToken = async () => {
    if (!hfTokenInput.trim()) return;
    setHfSaving(true);
    try {
      await window.electronAPI.vault.set('hf_token', hfTokenInput);
      const res = await window.electronAPI.request({
        method: 'PUT',
        path: '/settings/hf_token_present',
        body: { value: 'true' },
      });
      if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
      setHfTokenInput('');
      setHfTokenPresent(true);
      setHfDialogOpen(false);
      toast.success('HuggingFace token saved');
    } catch (e: unknown) {
      toast.error('Failed to save HuggingFace token: ' + errMessage(e));
    } finally {
      setHfSaving(false);
    }
  };

  const fetchModels = async (): Promise<ModelInfo[]> => {
    try {
      const res = await window.electronAPI.request({ method: 'GET', path: '/models' });
      if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
      const body = res.body as { items?: ModelInfo[] } | ModelInfo[] | null;
      const items = Array.isArray(body) ? body : (body?.items ?? []);
      setModels(items);
      return items;
    } catch (e: unknown) {
      toast.error('Failed to fetch models: ' + errMessage(e));
      return [];
    }
  };

  const silentReverify = async (model: ModelInfo) => {
    try {
      await window.electronAPI.request({
        method: 'POST',
        path: `/models/${encodeModelId(model.id)}/verify`,
      });
    } catch {
      void 0;
    }
  };

  useEffect(() => {
    void (async () => {
      const items = await fetchModels();
      await refreshHfTokenPresent();
      const verified = items.filter((m) => m.state === 'verified');
      await Promise.all(verified.map(silentReverify));
    })();
  }, []);

  const anyDownloading = Object.values(progress).some((p) => p.state === 'downloading');

  const startDownload = async (model: ModelInfo) => {
    try {
      const res = await window.electronAPI.request({
        method: 'POST',
        path: `/models/${encodeModelId(model.id)}/download`,
      });
      if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
      const { job_id } = res.body as { job_id: string };

      setProgress(model.id, {
        jobId: job_id,
        bytesDone: 0,
        totalBytes: 100,
        speedMbps: 0,
        currentFile: '',
        state: 'downloading',
      });

      const dispose = window.electronAPI.stream(
        { streamId: `download:${job_id}`, path: `/models/jobs/${job_id}/events` },
        (e: { event: string; data: unknown }) => {
          if (e.event === 'progress') {
            const data = e.data as {
              bytes_done: number;
              bytes_total: number;
              speed_mbps: number;
              current_file: string | null;
              state?: string;
              error?: string;
              error_code?: string;
            };
            setProgress(model.id, {
              bytesDone: data.bytes_done,
              totalBytes: data.bytes_total,
              speedMbps: data.speed_mbps,
              currentFile: data.current_file ?? '',
            });
            if (data.state === 'completed') {
              dispose();
              setProgress(model.id, { state: 'done' });
              setActiveDownloads((prev) => {
                const n = { ...prev };
                delete n[model.id];
                return n;
              });
              toast.success(`Downloaded ${model.name}`);
              fetchModels();
            } else if (data.state === 'failed') {
              dispose();
              setProgress(model.id, {
                state: 'error',
                error: data.error,
                errorCode: data.error_code,
              });
              setActiveDownloads((prev) => {
                const n = { ...prev };
                delete n[model.id];
                return n;
              });
              if (data.error_code === 'AUTH_REQUIRED') {
                setHfDialogOpen(true);
                toast.error('HuggingFace login required for this model');
              } else {
                toast.error(`Download failed: ${data.error ?? 'unknown error'}`);
              }
              fetchModels();
            }
          }
        },
        () => {
          dispose();
        },
        (err: StreamError) => {
          dispose();
          const msg = err.message || 'Unknown error';
          setProgress(model.id, { state: 'error', error: msg });
          setActiveDownloads((prev) => {
            const n = { ...prev };
            delete n[model.id];
            return n;
          });
          toast.error(`Download failed: ${msg}`);
          fetchModels();
        },
      );

      setActiveDownloads((prev) => ({ ...prev, [model.id]: { dispose, jobId: job_id } }));
    } catch (e: unknown) {
      toast.error('Failed to start download: ' + errMessage(e));
    }
  };

  const cancelDownload = async (modelId: string) => {
    const job = progress[modelId];
    if (!job || job.state !== 'downloading') return;

    try {
      await window.electronAPI.request({
        method: 'DELETE',
        path: `/models/${encodeModelId(modelId)}/download/${job.jobId}`,
      });
      const handle = activeDownloads[modelId];
      if (handle) {
        handle.dispose();
        setActiveDownloads((prev) => {
          const n = { ...prev };
          delete n[modelId];
          return n;
        });
      }
      setProgress(modelId, { state: 'cancelled' });
      toast.info('Download cancelled');
      fetchModels();
    } catch (e: unknown) {
      toast.error('Failed to cancel download: ' + errMessage(e));
    }
  };

  const verifyModel = async (model: ModelInfo) => {
    try {
      const res = await window.electronAPI.request({
        method: 'POST',
        path: `/models/${encodeModelId(model.id)}/verify`,
      });
      if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
      const result = res.body as { valid: boolean; mismatches?: unknown[] };

      if (result.valid) {
        toast.success(`${model.name} is fully verified`);
      } else {
        toast.error(`${model.name} has ${result.mismatches?.length ?? 0} corrupted files`);
      }
      fetchModels();
    } catch (e: unknown) {
      toast.error('Failed to verify model: ' + errMessage(e));
    }
  };

  const deleteModel = async (model: ModelInfo) => {
    try {
      const res = await window.electronAPI.request({
        method: 'DELETE',
        path: `/models/${encodeModelId(model.id)}`,
      });
      if (res.status !== 204 && (res.status < 200 || res.status >= 300)) {
        throw new Error(`HTTP ${res.status}`);
      }
      toast.success(`Deleted ${model.name}`);
      fetchModels();
    } catch (e: unknown) {
      toast.error('Failed to delete model: ' + errMessage(e));
    }
  };

  const getBadgeProps = (state: string) => {
    switch (state) {
      case 'missing':
        return {
          variant: 'outline' as const,
          style: { borderColor: 'var(--color-text-muted)', color: 'var(--color-text-muted)' },
        };
      case 'downloading':
        return { variant: 'default' as const, style: { backgroundColor: 'var(--color-primary)' } };
      case 'verified':
        return { variant: 'default' as const, style: { backgroundColor: 'var(--color-success)' } };
      case 'partial':
        return {
          variant: 'default' as const,
          style: { backgroundColor: 'var(--color-warning)', color: 'var(--color-text-base)' },
        };
      case 'corrupted':
        return {
          variant: 'destructive' as const,
          style: { backgroundColor: 'var(--color-danger)' },
        };
      default:
        return { variant: 'outline' as const };
    }
  };

  return (
    <div className="container mx-auto py-10 max-w-5xl">
      {/* AUDIOMORPH_TEST_MODE hook */}
      <span hidden data-testid="route-ready" />
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">Model Library</h1>
        <Button
          variant="outline"
          size="sm"
          data-testid="hf-login-button"
          onClick={() => setHfDialogOpen(true)}
        >
          HuggingFace Login
        </Button>
      </div>

      <Dialog open={hfDialogOpen} onOpenChange={setHfDialogOpen}>
        <DialogContent data-testid="hf-login-dialog">
          <DialogHeader>
            <DialogTitle>HuggingFace Login</DialogTitle>
            <DialogDescription>
              Paste an HF access token (hf_...) to authorize gated / private model downloads. The
              token is stored in your OS keychain and never leaves this machine.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="hf-login-input">Access Token</Label>
            <Input
              id="hf-login-input"
              type="password"
              placeholder="hf_..."
              value={hfTokenInput}
              onChange={(e) => setHfTokenInput(e.target.value)}
              data-testid="hf-login-input"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setHfTokenInput('');
                setHfDialogOpen(false);
              }}
            >
              Cancel
            </Button>
            {hfTokenPresent && (
              <Button variant="destructive" onClick={signOutHf} data-testid="hf-signout">
                Sign Out
              </Button>
            )}
            <Button
              onClick={saveHfToken}
              disabled={!hfTokenInput.trim() || hfSaving}
              data-testid="hf-login-save"
            >
              {hfSaving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {models.map((model) => {
          const dl = progress[model.id];
          const isDownloading = dl?.state === 'downloading';
          const pct = isDownloading && dl.totalBytes > 0 ? (dl.bytesDone / dl.totalBytes) * 100 : 0;

          return (
            <Card key={model.id} className="flex flex-col">
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="mb-2">{model.name}</CardTitle>
                    <CardDescription className="font-mono text-xs">{model.repo_id}</CardDescription>
                  </div>
                  <Badge {...getBadgeProps(model.state)}>{model.state}</Badge>
                </div>
              </CardHeader>

              <CardContent className="flex-grow">
                <div className="text-sm mb-4">Size: {model.size_gb.toFixed(2)} GB</div>

                {isDownloading && (
                  <div className="space-y-3 bg-surface p-4 rounded-md border border-border">
                    <div className="flex justify-between text-sm font-medium">
                      <span>Downloading...</span>
                      <span>
                        <NumberTicker value={dl.speedMbps} /> Mbps
                      </span>
                    </div>
                    <Progress value={pct} className="h-2" />
                    <div className="flex justify-between text-xs text-text-muted font-mono truncate">
                      <span className="truncate mr-4">{dl.currentFile || 'Connecting...'}</span>
                      <span className="whitespace-nowrap">
                        <NumberTicker value={dl.bytesDone} /> /{' '}
                        <NumberTicker value={dl.totalBytes} /> bytes
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>

              <CardFooter className="flex justify-end gap-2 border-t pt-4">
                {isDownloading ? (
                  <Button variant="destructive" size="sm" onClick={() => cancelDownload(model.id)}>
                    Cancel
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => startDownload(model)}
                      disabled={model.state === 'verified' || anyDownloading}
                    >
                      Download
                    </Button>

                    {model.state !== 'missing' && (
                      <>
                        <Button variant="outline" size="sm" onClick={() => verifyModel(model)}>
                          Verify
                        </Button>

                        <AlertDialog>
                          <AlertDialogTrigger className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 h-8 px-3 text-xs">
                            Delete
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete {model.name}?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently remove the model files from your disk. You
                                will need to download it again to use it.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteModel(model)}
                                className="bg-[var(--color-danger)] text-white hover:bg-[var(--color-danger)]/90"
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </>
                    )}
                  </>
                )}
              </CardFooter>
            </Card>
          );
        })}
      </div>

      {models.length === 0 && (
        <div className="text-center py-20 text-text-muted">No models available.</div>
      )}
    </div>
  );
}
