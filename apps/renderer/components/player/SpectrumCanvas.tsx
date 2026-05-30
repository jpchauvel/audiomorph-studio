'use client';
import { useEffect, useRef } from 'react';

type Props = { audioElement?: HTMLAudioElement | null; width?: number; height?: number };

type ElementGraph = {
  ctx: AudioContext;
  source: MediaElementAudioSourceNode;
};

const ELEMENT_GRAPHS = new WeakMap<HTMLAudioElement, ElementGraph>();

function getOrCreateGraph(el: HTMLAudioElement): ElementGraph {
  const existing = ELEMENT_GRAPHS.get(el);
  if (existing && existing.ctx.state !== 'closed') {
    return existing;
  }
  const ctx = new AudioContext();
  const source = ctx.createMediaElementSource(el);
  const graph: ElementGraph = { ctx, source };
  ELEMENT_GRAPHS.set(el, graph);
  return graph;
}

export function SpectrumCanvas({ audioElement, width = 300, height = 80 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!audioElement || !canvasRef.current) return;
    const { ctx, source } = getOrCreateGraph(audioElement);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    analyser.connect(ctx.destination);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const canvas = canvasRef.current;
    const c = canvas.getContext('2d')!;
    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(data);
      c.clearRect(0, 0, width, height);
      const barW = width / data.length;
      data.forEach((v, i) => {
        const h = (v / 255) * height;
        c.fillStyle = `oklch(65% 0.22 ${200 + i * 0.5})`;
        c.fillRect(i * barW, height - h, barW - 1, h);
      });
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      try {
        analyser.disconnect();
      } catch {}
      try {
        source.disconnect(analyser);
      } catch {}
    };
  }, [audioElement, width, height]);

  return <canvas ref={canvasRef} width={width} height={height} data-testid="spectrum-canvas" />;
}
