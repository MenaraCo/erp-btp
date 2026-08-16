'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Zone de signature manuscrite — au doigt sur tablette, à la souris au bureau.
 *
 * Le nom saisi vaut déjà signature sur un relevé papier ; le tracé, lui, est ce qu'un salarié
 * reconnaît comme le sien. On dessine donc dans un canvas et on renvoie une image PNG, prête à
 * être posée dans le PDF du relevé.
 *
 * Le canvas est dimensionné en pixels RÉELS (densité de l'écran comprise) : sans cela, un tracé
 * fait sur tablette ressortait flou et décalé du doigt.
 */
export function Signature({
  onChange, hauteur = 150,
}: {
  /** Image PNG (data URL) à chaque trait terminé, ou null quand la zone est effacée. */
  onChange: (image: string | null) => void;
  hauteur?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dessine = useRef(false);
  const [vide, setVide] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const largeur = canvas.parentElement?.clientWidth ?? 400;
    canvas.width = largeur * ratio;
    canvas.height = hauteur * ratio;
    canvas.style.width = `${largeur}px`;
    canvas.style.height = `${hauteur}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0f172a';
  }, [hauteur]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const debut = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    // On capture le pointeur : sans cela, un doigt qui sort du cadre coupe le trait en deux.
    e.currentTarget.setPointerCapture(e.pointerId);
    dessine.current = true;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };

  const trace = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dessine.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const p = point(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    if (vide) setVide(false);
  };

  const fin = () => {
    if (!dessine.current) return;
    dessine.current = false;
    const canvas = canvasRef.current;
    if (canvas) onChange(canvas.toDataURL('image/png'));
  };

  const effacer = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setVide(true);
    onChange(null);
  };

  return (
    <div>
      <div style={{
        border: '1px dashed var(--border-strong)', borderRadius: 'var(--radius-sm)',
        background: 'var(--panel)', position: 'relative', overflow: 'hidden',
      }}>
        <canvas
          ref={canvasRef}
          onPointerDown={debut}
          onPointerMove={trace}
          onPointerUp={fin}
          onPointerLeave={fin}
          // touchAction: sans cela, le doigt fait défiler la page au lieu de dessiner.
          style={{ display: 'block', touchAction: 'none', cursor: 'crosshair' }}
        />
        {vide && (
          <span className="muted" style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontSize: 12, pointerEvents: 'none',
          }}>
            Signez ici, au doigt ou à la souris
          </span>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
        <button className="btn-ghost" type="button" onClick={effacer} disabled={vide}>
          Effacer
        </button>
      </div>
    </div>
  );
}
