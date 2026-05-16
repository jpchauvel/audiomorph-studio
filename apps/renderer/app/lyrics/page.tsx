'use client';
import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useGenerationStore } from '@/lib/stores/generation';

const API_BASE = () =>
  (typeof window !== 'undefined' && (window as any).__AUDIOMORPH_API_BASE__) ||
  'http://localhost:8000';
const TOKEN = () => (typeof window !== 'undefined' && (window as any).__AUDIOMORPH_TOKEN__) || '';
const headers = () => ({ 'X-Audiomorph-Token': TOKEN() });

type Segment = { start: number; end: number; text: string };

export default function LyricsPage() {
  const router = useRouter();
  const { setLyricsDraft } = useGenerationStore();
  const [lyrics, setLyrics] = useState('');
  const [segments, setSegments] = useState<Segment[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const transcribe = async (file: File) => {
    setTranscribing(true);
    setSegments([]);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${API_BASE()}/lyrics/transcribe`, {
        method: 'POST',
        headers: headers(),
        body: form,
      });
      if (!res.ok) {
        toast.error('Transcription failed');
        setTranscribing(false);
        return;
      }
      const { job_id } = await res.json();
      setJobId(job_id);

      const es = new EventSource(`${API_BASE()}/lyrics/jobs/${job_id}/events`);
      esRef.current = es;
      es.addEventListener('progress', (e) => {
        const d = JSON.parse(e.data);
        if (d.segments) setSegments(d.segments);
      });
      es.addEventListener('done', (e) => {
        const d = JSON.parse(e.data);
        const text = d.segments?.map((s: Segment) => s.text).join('\n') ?? '';
        setLyrics(text);
        setSegments(d.segments ?? []);
        setTranscribing(false);
        es.close();
      });
      es.addEventListener('error', (e: any) => {
        const msg = e.data ? JSON.parse(e.data).message : 'Transcription error';
        toast.error(msg);
        setTranscribing(false);
        es.close();
      });
    } catch {
      toast.error('Failed to start transcription');
      setTranscribing(false);
    }
  };

  const cancel = async () => {
    if (!jobId) return;
    esRef.current?.close();
    await fetch(`${API_BASE()}/lyrics/jobs/${jobId}`, {
      method: 'DELETE',
      headers: headers(),
    }).catch(() => {});
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
