'use client';
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useGenerationStore } from '@/lib/stores/generation';

type Segment = { start: number; end: number; text: string };

export default function LyricsPage() {
  const router = useRouter();
  const { setLyricsDraft } = useGenerationStore();
  const [lyrics, setLyrics] = useState('');
  const [segments, setSegments] = useState<Segment[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const streamDisposeRef = useRef<(() => void) | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (streamDisposeRef.current) {
        streamDisposeRef.current();
      }
    };
  }, []);

  const transcribe = async (file: File) => {
    setTranscribing(true);
    setSegments([]);
    try {
      const audioPath = (file as File & { path: string }).path;
      if (!audioPath) {
        toast.error('File path not found. Please try again.');
        setTranscribing(false);
        return;
      }

      const res = await window.electronAPI.request({
        method: 'POST',
        path: '/lyrics/transcribe',
        body: { audio_path: audioPath },
      });

      if (res.status < 200 || res.status >= 300) {
        toast.error('Transcription failed');
        setTranscribing(false);
        return;
      }
      const { job_id } = res.body as { job_id: string };
      setJobId(job_id);

      const dispose = window.electronAPI.stream(
        { streamId: `lyrics-job-${job_id}`, path: `/lyrics/jobs/${job_id}/events` },
        (e: { event: string; data: unknown }) => {
          if (e.event === 'progress') {
            const d = e.data as { segments?: Segment[] };
            if (d.segments) setSegments(d.segments);
          } else if (e.event === 'done') {
            const d = e.data as { segments?: Segment[] };
            const text = d.segments?.map((s: Segment) => s.text).join('\n') ?? '';
            setLyrics(text);
            setSegments(d.segments ?? []);
            setTranscribing(false);
            dispose();
            streamDisposeRef.current = null;
          } else if (e.event === 'error') {
            const d = e.data as { message?: string } | null;
            const msg = d?.message ?? 'Transcription error';
            toast.error(msg);
            setTranscribing(false);
            dispose();
            streamDisposeRef.current = null;
          }
        },
        () => {
          dispose();
          streamDisposeRef.current = null;
        },
        (err: { message: string }) => {
          toast.error(err.message || 'Transcription error');
          setTranscribing(false);
          dispose();
          streamDisposeRef.current = null;
        },
      );
      streamDisposeRef.current = dispose;
    } catch {
      toast.error('Failed to start transcription');
      setTranscribing(false);
    }
  };

  const cancel = async () => {
    if (!jobId) return;
    if (streamDisposeRef.current) {
      streamDisposeRef.current();
      streamDisposeRef.current = null;
    }
    await window.electronAPI
      .request({
        method: 'DELETE',
        path: `/lyrics/jobs/${jobId}`,
      })
      .catch(() => {});
    setTranscribing(false);
    setJobId(null);
  };

  const useInGeneration = () => {
    setLyricsDraft(lyrics);
    router.push('/');
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) transcribe(file);
  };

  const fmt = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  return (
    <div className="max-w-2xl mx-auto p-8 flex flex-col gap-6" data-testid="lyrics-workspace">
      {/* AUDIOMORPH_TEST_MODE hook */}
      <span hidden data-testid="route-ready" />
      <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
        Lyrics Workspace
      </h1>

      <input
        type="file"
        accept="audio/*"
        className="hidden"
        ref={fileInputRef}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) transcribe(f);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }}
      />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        data-testid="drop-zone"
        className="rounded-xl p-8 text-center cursor-pointer transition-colors"
        style={{
          border: `2px dashed ${dragOver ? 'var(--color-primary)' : 'var(--color-border)'}`,
          background: dragOver ? 'var(--color-surface-3)' : 'var(--color-surface-2)',
          color: 'var(--color-text-muted)',
        }}
      >
        {transcribing ? '⏳ Transcribing…' : 'Drop audio file here or click to upload'}
      </div>

      {transcribing && (
        <Button variant="outline" onClick={cancel} data-testid="cancel-transcription-btn">
          Cancel transcription
        </Button>
      )}

      {segments.length > 0 && (
        <div
          className="flex flex-col gap-1 max-h-48 overflow-y-auto rounded-lg p-3"
          style={{ background: 'var(--color-surface-3)' }}
        >
          {segments.map((seg, i) => (
            <div key={i} className="flex gap-3 text-sm">
              <span style={{ color: 'var(--color-text-muted)', minWidth: 80 }}>
                {fmt(seg.start)} – {fmt(seg.end)}
              </span>
              <span style={{ color: 'var(--color-text)' }}>{seg.text}</span>
            </div>
          ))}
        </div>
      )}

      <textarea
        value={lyrics}
        onChange={(e) => setLyrics(e.target.value)}
        placeholder="Lyrics will appear here after transcription, or type manually…"
        rows={10}
        data-testid="lyrics-editor"
        className="w-full rounded-lg p-3 text-sm resize-y"
        style={{
          background: 'var(--color-surface-2)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text)',
          outline: 'none',
        }}
      />

      <Button
        onClick={useInGeneration}
        disabled={!lyrics.trim()}
        data-testid="use-in-generation-btn"
      >
        Use in Generation →
      </Button>
    </div>
  );
}
