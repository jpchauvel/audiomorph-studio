'use client';
import { useEffect, useRef, useState } from 'react';
import type WaveSurfer from 'wavesurfer.js';
import { SpectrumCanvas } from './SpectrumCanvas';

type Props = { audioUrl: string; onReady?: () => void };

export function WaveformPlayer({ audioUrl, onReady }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let ws: WaveSurfer;
    import('wavesurfer.js').then(({ default: WaveSurfer }) => {
      ws = WaveSurfer.create({
        container: containerRef.current!,
        waveColor: 'var(--color-primary)',
        progressColor: 'var(--color-accent)',
        cursorColor: 'var(--color-text)',
        height: 80,
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        normalize: true,
      });
      ws.load(audioUrl);
      ws.on('ready', () => {
        setDuration(ws.getDuration());
        onReady?.();
      });
      ws.on('audioprocess', () => setCurrentTime(ws.getCurrentTime()));
      ws.on('play', () => setPlaying(true));
      ws.on('pause', () => setPlaying(false));
      wsRef.current = ws;

      const mediaElement = ws.getMediaElement();
      if (mediaElement) {
        setAudioElement(mediaElement);
      }
    });
    return () => {
      ws?.destroy();
    };
  }, [audioUrl, onReady]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        wsRef.current?.playPause();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const toggle = () => wsRef.current?.playPause();
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  return (
    <div className="flex flex-col gap-4 w-full" data-testid="waveform-player" tabIndex={0}>
      <div className="flex flex-col gap-2">
        <div ref={containerRef} style={{ background: 'var(--color-surface-3)', borderRadius: 8 }} />
        {audioElement && <SpectrumCanvas audioElement={audioElement} width={300} height={80} />}
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={toggle}
          aria-label={playing ? 'Pause' : 'Play'}
          data-testid="play-pause-btn"
          style={{ color: 'var(--color-primary)', fontSize: 24 }}
          className="hover:scale-110 transition-transform"
        >
          {playing ? '⏸' : '▶'}
        </button>
        <span style={{ color: 'var(--color-text-muted)', fontSize: 13 }} className="font-mono">
          {fmt(currentTime)} / {fmt(duration)}
        </span>
      </div>
    </div>
  );
}
