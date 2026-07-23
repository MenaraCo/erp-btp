'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { apiFetch } from '@/lib/api';
import { euro } from '@/lib/format';

/* ─────────── types ─────────── */
interface PilotagePoint {
  month: string;
  engage: string;
  realise: string;
  engageRealise: string;
  budgetAvance: string | null;
  eac: string | null;
  closed: boolean;
}
interface Series {
  chantierId: string;
  budget: string;
  points: PilotagePoint[];
}

function monthShort(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, 1)).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}

/** Courbes de pilotage d'un chantier (cahier §5.8) : budget / budget avancé / réalisé+engagé. */
export default function PilotagePage() {
  const { token } = useAuth();
  const chantierId = String(useParams().chantierId);

  const chantier = useQuery({
    queryKey: ['chantier', chantierId],
    enabled: Boolean(token),
    queryFn: () => apiFetch<{ code: string }>(`/chantiers/${chantierId}`, { token }),
  });
  const series = useQuery({
    queryKey: ['pilotage', chantierId],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => apiFetch<Series>(`/chantiers/${chantierId}/pilotage`, { token }),
  });

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        <Link href={`/chantiers/${chantierId}`} className="link">← Chantier {chantier.data?.code ?? ''}</Link>
      </p>
      <h1 style={{ marginBottom: 4 }}>Courbes de pilotage</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Budget, budget avancé et dépense (réalisé + engagé) mois par mois. Quand la dépense passe
        au-dessus du budget avancé, le chantier dérive.
      </p>

      {series.isError && (
        <p className="muted">Module « Gestion financière » non actif pour cet utilisateur, ou accès refusé.</p>
      )}

      {series.data && (
        <div className="card" style={{ marginTop: 12 }}>
          <PilotageChart series={series.data} />
        </div>
      )}
    </div>
  );
}

/* ─────────── graphe SVG ─────────── */
function PilotageChart({ series }: { series: Series }) {
  const W = 860;
  const H = 340;
  const PAD = { top: 20, right: 20, bottom: 34, left: 66 };

  const budget = Number(series.budget);
  const pts = series.points;

  const maxY = useMemo(() => {
    const vals = [budget];
    for (const p of pts) {
      vals.push(Number(p.engageRealise));
      if (p.budgetAvance != null) vals.push(Number(p.budgetAvance));
      if (p.eac != null) vals.push(Number(p.eac));
    }
    const m = Math.max(1, ...vals);
    // arrondi vers le haut pour un axe lisible
    const pow = Math.pow(10, Math.floor(Math.log10(m)));
    return Math.ceil(m / pow) * pow;
  }, [pts, budget]);

  if (pts.length === 0) {
    return <p className="muted" style={{ padding: 8 }}>Aucun mouvement à tracer.</p>;
  }

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (pts.length === 1 ? innerW / 2 : (i / (pts.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / maxY) * innerH;

  const line = (pick: (p: PilotagePoint) => number | null) => {
    const segs: string[] = [];
    let penDown = false;
    pts.forEach((p, i) => {
      const v = pick(p);
      if (v == null) { penDown = false; return; }
      segs.push(`${penDown ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`);
      penDown = true;
    });
    return segs.join(' ');
  };

  const ticks = 4;
  const gridVals = Array.from({ length: ticks + 1 }, (_, i) => (maxY / ticks) * i);

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 640, display: 'block' }} role="img" aria-label="Courbes de pilotage">
          {/* grille + axe Y */}
          {gridVals.map((v, i) => (
            <g key={i}>
              <line x1={PAD.left} y1={y(v)} x2={W - PAD.right} y2={y(v)} stroke="var(--border)" strokeWidth={1} />
              <text x={PAD.left - 8} y={y(v) + 3} textAnchor="end" fontSize={10} fill="var(--muted)">
                {v >= 1000 ? `${Math.round(v / 1000)} k€` : `${Math.round(v)} €`}
              </text>
            </g>
          ))}
          {/* axe X : mois */}
          {pts.map((p, i) => (
            <text key={p.month} x={x(i)} y={H - PAD.bottom + 16} textAnchor="middle" fontSize={10} fill="var(--muted)">
              {monthShort(p.month)}
            </text>
          ))}

          {/* budget : ligne de référence pointillée */}
          <line x1={PAD.left} y1={y(budget)} x2={W - PAD.right} y2={y(budget)} stroke="#64748b" strokeWidth={1.5} strokeDasharray="5 4" />

          {/* budget avancé (bleu) et dépense réalisé+engagé (orange) */}
          <path d={line((p) => (p.budgetAvance != null ? Number(p.budgetAvance) : null))} fill="none" stroke="var(--primary)" strokeWidth={2} />
          <path d={line((p) => Number(p.engageRealise))} fill="none" stroke="var(--accent)" strokeWidth={2.5} />

          {/* points de la dépense */}
          {pts.map((p, i) => (
            <circle
              key={p.month}
              cx={x(i)}
              cy={y(Number(p.engageRealise))}
              r={p.closed ? 4 : 3.5}
              fill={p.closed ? 'var(--accent)' : 'var(--panel)'}
              stroke="var(--accent)"
              strokeWidth={1.5}
            >
              <title>{`${monthShort(p.month)} — dépense ${euro(p.engageRealise)}${p.closed ? ' (clôturé)' : ''}`}</title>
            </circle>
          ))}
        </svg>
      </div>

      {/* légende */}
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginTop: 10, fontSize: 12 }}>
        <Legend color="#64748b" dashed label={`Budget objectif · ${euro(series.budget)}`} />
        <Legend color="var(--primary)" label="Budget avancé (crédit débloqué)" />
        <Legend color="var(--accent)" label="Réalisé + engagé (dépense)" />
      </div>
      <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
        Budget avancé et EAC proviennent des mois clôturés (point figé) et du mois en cours (calculé en direct).
      </p>
    </div>
  );
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <svg width={22} height={8}><line x1={0} y1={4} x2={22} y2={4} stroke={color} strokeWidth={2.5} strokeDasharray={dashed ? '4 3' : undefined} /></svg>
      {label}
    </span>
  );
}
