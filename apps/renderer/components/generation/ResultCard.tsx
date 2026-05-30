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

function ResultCardSingle({ jobId, index, total }: { jobId: string; index: number; total: number }) {
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.fetchAudio) {
      setAudioError('Audio bridge unavailable');
      return;
    }
    let cancelled = false;
    let createdUrl: string | null = null;
    setAudioError(null);
    void api
      .fetchAudio({ jobId })
      .then(({ bytes, contentType }: { bytes: Uint8Array; contentType: string }) => {
        if (cancelled) return;
        const ab = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(ab).set(bytes);
        const blob = new Blob([ab], { type: contentType });
        createdUrl = URL.createObjectURL(blob);
        setAudioUrl(createdUrl);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setAudioError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [jobId]);

  return (
    <Card className="border border-[var(--color-success)] bg-[var(--color-success)]/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-[var(--color-success)] flex items-center gap-2">
          <span>✓</span>
          {total > 1 ? `Song ${index + 1} of ${total}` : 'Generation complete'}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-[var(--color-text-muted)]">Job ID</span>
          <code className="text-sm px-2 py-1 rounded bg-[var(--color-surface-3)] text-[var(--color-text)]">
            {jobId}
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
      <ExportDialog open={isExportOpen} onClose={() => setIsExportOpen(false)} jobId={jobId} />
    </Card>
  );
}

export function ResultCard() {
  const { completedJobIds, numSongsTotal } = useGenerationStore();
  if (completedJobIds.length === 0) return null;
  return (
    <div className="mt-6 flex flex-col gap-4">
      {completedJobIds.map((id, i) => (
        <ResultCardSingle key={id} jobId={id} index={i} total={numSongsTotal} />
      ))}
    </div>
  );
}
