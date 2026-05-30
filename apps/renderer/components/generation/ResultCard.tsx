'use client';

import { useEffect, useState } from 'react';
import { useGenerationStore } from '@/lib/stores/generation';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import dynamic from 'next/dynamic';
import { ExportDialog } from '@/components/export/ExportDialog';

const WaveformPlayer = dynamic(
  () => import('@/components/player/WaveformPlayer').then((m) => m.WaveformPlayer),
  { ssr: false },
);

export function ResultCard() {
  const { phase, resultJobId } = useGenerationStore();
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);

  useEffect(() => {
    if (phase !== 'done' || !resultJobId) {
      setAudioUrl(null);
      return;
    }
    const api = window.electronAPI;
    if (!api?.fetchAudio) {
      setAudioError('Audio bridge unavailable');
      return;
    }
    let cancelled = false;
    let createdUrl: string | null = null;
    setAudioError(null);
    void api
      .fetchAudio({ jobId: resultJobId })
      .then(({ bytes, contentType }) => {
        if (cancelled) return;
        const blob = new Blob([new Uint8Array(bytes)], { type: contentType });
        createdUrl = URL.createObjectURL(blob);
        setAudioUrl(createdUrl);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setAudioError(msg);
      });
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [phase, resultJobId]);

  if (phase !== 'done' || !resultJobId) return null;

  return (
    <Card className="mt-6 border border-[var(--color-success)] bg-[var(--color-success)]/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-[var(--color-success)] flex items-center gap-2">
          <span>✓</span> Generation complete
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-[var(--color-text-muted)]">Job ID</span>
          <code className="text-sm px-2 py-1 rounded bg-[var(--color-surface-3)] text-[var(--color-text)]">
            {resultJobId}
          </code>
        </div>

        {audioError && (
          <div
            className="text-sm text-[var(--color-danger)]"
            data-testid="result-card-audio-error"
          >
            Failed to load audio: {audioError}
          </div>
        )}
        {audioUrl && <WaveformPlayer audioUrl={audioUrl} />}
        <div className="flex justify-end">
          <Button onClick={() => setIsExportOpen(true)}>Export</Button>
        </div>
      </CardContent>
      <ExportDialog
        open={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        jobId={resultJobId}
      />
    </Card>
  );
}
