'use client';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';

type Format = 'wav' | 'mp3' | 'flac';
const BITRATES = [64, 128, 192, 256, 320];

type Props = { open: boolean; onClose: () => void; jobId: string };

export function ExportDialog({ open, onClose, jobId }: Props) {
  const [format, setFormat] = useState<Format>('wav');
  const [bitrate, setBitrate] = useState(192);
  const [loading, setLoading] = useState(false);

  const apiBase =
    typeof window !== 'undefined'
      ? ((window as any).__AUDIOMORPH_API_BASE__ ?? 'http://localhost:8000')
      : 'http://localhost:8000';
  const token = typeof window !== 'undefined' ? ((window as any).__AUDIOMORPH_TOKEN__ ?? '') : '';

  const handleExport = async () => {
    setLoading(true);
    try {
      const body: Record<string, unknown> = { job_id: jobId, format };
      if (format === 'mp3') body.bitrate_kbps = bitrate;
      const res = await fetch(`${apiBase}/export`, {
        method: 'POST',
        headers: { 'X-Audiomorph-Token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.message ?? 'Export failed', { description: err.hint });
        return;
      }
      const { file_path } = await res.json();
      toast.success(`Exported to ${file_path}`, {
        action: {
          label: 'Show in Finder',
          onClick: () => (window as any).__AUDIOMORPH_IPC__?.showItemInFolder?.(file_path),
        },
      });
      onClose();
    } catch {
      toast.error('Export failed — check sidecar connection');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}
      >
        <DialogHeader>
          <DialogTitle style={{ color: 'var(--color-text)' }}>Export Audio</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div>
            <label className="text-sm mb-1 block" style={{ color: 'var(--color-text-muted)' }}>
              Format
            </label>
            <Select value={format} onValueChange={(v) => setFormat(v as Format)}>
              <SelectTrigger data-testid="format-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="wav">WAV (lossless)</SelectItem>
                <SelectItem value="flac">FLAC (lossless compressed)</SelectItem>
                <SelectItem value="mp3">MP3 (lossy)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {format === 'mp3' && (
            <div>
              <label className="text-sm mb-1 block" style={{ color: 'var(--color-text-muted)' }}>
                Bitrate
              </label>
              <Select value={String(bitrate)} onValueChange={(v) => setBitrate(Number(v))}>
                <SelectTrigger data-testid="bitrate-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BITRATES.map((b) => (
                    <SelectItem key={b} value={String(b)}>
                      {b} kbps
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={loading} data-testid="export-btn">
            {loading ? 'Exporting…' : 'Export'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
