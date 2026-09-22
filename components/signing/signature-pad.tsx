'use client';

import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';

// Drawing a signature with a finger, pen or mouse. Pointer events cover all three; the canvas is drawn at the screen's
// pixel density so the stroke stays sharp, and exported as a PNG on a transparent background.

export function SignaturePad({ onChange }: { onChange: (image: Blob | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const drawn = useRef(false);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const ratio = window.devicePixelRatio || 1;
    element.width = element.offsetWidth * ratio;
    element.height = element.offsetHeight * ratio;
    const context = element.getContext('2d');
    if (!context) return;
    context.scale(ratio, ratio);
    context.lineWidth = 2;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = '#111827';
  }, []);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const finish = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (drawn.current) canvas.current?.toBlob((blob) => onChange(blob), 'image/png');
  };

  const clear = () => {
    const element = canvas.current;
    element?.getContext('2d')?.clearRect(0, 0, element.width, element.height);
    drawn.current = false;
    onChange(null);
  };

  return (
    <div className="space-y-2">
      <canvas
        ref={canvas}
        aria-label="Draw your signature here"
        role="img"
        className="h-40 w-full touch-none rounded-md border border-dashed bg-white"
        onPointerDown={(event) => {
          const context = event.currentTarget.getContext('2d');
          if (!context) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drawing.current = true;
          const { x, y } = point(event);
          context.beginPath();
          context.moveTo(x, y);
        }}
        onPointerMove={(event) => {
          if (!drawing.current) return;
          const context = event.currentTarget.getContext('2d');
          if (!context) return;
          const { x, y } = point(event);
          context.lineTo(x, y);
          context.stroke();
          drawn.current = true;
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
      />
      <Button type="button" variant="ghost" size="sm" onClick={clear}>
        Clear
      </Button>
    </div>
  );
}
