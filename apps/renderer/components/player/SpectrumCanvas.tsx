'use client';
import { useEffect, useRef } from 'react';

type Props = { audioElement?: HTMLAudioElement | null; width?: number; height?: number };

export function SpectrumCanvas({ audioElement, width = 300, height = 80 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!audioElement || !canvasRef.current) return;
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    const source = ctx.createMediaElementSource(audioElement);
    source.connect(analyser);
    analyser.connect(ctx.destination);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const canvas = canvasRef.current;
    const c = canvas.getContext('2d')!;
    let raf: number;

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
      ctx.close();
    };
  }, [audioElement, width, height]);

  return <canvas ref={canvasRef} width={width} height={height} data-testid="spectrum-canvas" />;
}
