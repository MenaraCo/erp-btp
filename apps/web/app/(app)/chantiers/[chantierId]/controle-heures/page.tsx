'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Lock } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { euro } from '@/lib/format';

interface SalarieControle {
  employeeId: string | null;
  label: string;
  jours: Record<string, string>;
  heures: string;
  cout: string;
  anomalies: string[];
}
interface Controle {
  mois: string;
  debut: string;
  fin: string;
  salaries: SalarieControle[];
  totalHeures: string;
  totalCout: string;
  lignes: number;
  impute: boolean;
  anomalies: number;
}

/** Mois courant au format AAAA-MM. */
function moisCourant(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Contrôle des heures d'un mois, avant de l'arrêter.
 *
 * Le conducteur relit la grille salarié × jour, corrige ce qui cloche dans la saisie, puis
 * ARRÊTE le mois : les heures deviennent alors non modifiables, parce qu'elles alimentent un
 * résultat de chantier qui sera présenté au client.
 */
export default function ControleHeuresPage() {
  const { token } = useAuth();
  const chantierId = String(useParams().chantierId);
  const qc = useQueryClient();
  const [mois, setMois] = useState(moisCourant());
  const [err, setErr] = useState<string | null>(null);
  const [confirmer, setConfirmer] = useState(false);

  const controle = useQuery({
    queryKey: ['controle-heures', chantierId, mois],
    enabled: Boolean(token) && /^\d{4}-\d{2}$/.test(mois),
    queryFn: () =>
      apiFetch<Controle>(`/chantiers/${chantierId}/timesheets/controle?mois=${mois}`, { token }),
  });

  const imputer = useMutation({
    mutationFn: () =>
      apiFetch<{ imputes: number }>(`/chantiers/${chantierId}/timesheets/imputation`, {
        method: 'POST', token, body: { mois },
      }),
    onSuccess: (r) => {
      setErr(null);
      setConfirmer(false);
      qc.invalidateQueries({ queryKey: ['controle-heures'] });
      qc.invalidateQueries({ queryKey: ['timesheets'] });
      setErr(`${r.imputes} pointage${r.imputes > 1 ? 's' : ''} arrêté${r.imputes > 1 ? 's' : ''} pour ${mois}.`);
    },
    onError: (e) => { setConfirmer(false); setErr(e instanceof ApiError ? e.message : 'Imputation impossible'); },
  });

  const c = controle.data;
  // Les jours réellement pointés : inutile d'afficher 31 colonnes vides.
  const jours = c ? [...new Set(c.salaries.flatMap((s) => Object.keys(s.jours)))].sort() : [];

  return (
    <div>
      <h1 style={{ marginBottom: 4 }}>Contrôle des heures</h1>
      <p className="muted" style={{ marginTop: 0, maxWidth: 760 }}>
        Relisez le mois avant de l’arrêter. Une fois arrêté, les heures ne se modifient plus :
        elles alimentent le résultat du chantier, qui peut déjà avoir été présenté au client.
      </p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginTop: 12, flexWrap: 'wrap' }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Mois</label>
          <input type="month" value={mois} onChange={(e) => setMois(e.target.value)} style={{ width: 160 }} />
        </div>
        {c && !c.impute && c.lignes > 0 && (
          confirmer ? (
            <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
              <button className="btn btn-danger" disabled={imputer.isPending} onClick={() => imputer.mutate()}>
                {imputer.isPending ? 'Arrêt…' : `Arrêter définitivement ${mois} ?`}
              </button>
              <button className="link" type="button" onClick={() => setConfirmer(false)}>Annuler</button>
            </span>
          ) : (
            <button className="btn" onClick={() => { setErr(null); setConfirmer(true); }}>
              Arrêter le mois
            </button>
          )
        )}
        {c?.impute && (
          <span className="badge success" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Lock size={12} /> Mois arrêté
          </span>
        )}
      </div>

      {err && <div className="badge info" style={{ display: 'block', marginTop: 12, padding: '8px 10px' }}>{err}</div>}

      {c && c.lignes === 0 && (
        <p className="muted" style={{ marginTop: 16 }}>Aucune heure pointée sur ce mois.</p>
      )}

      {c && c.lignes > 0 && (
        <>
          <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="grid" style={{ margin: 0 }}>
                <thead>
                  <tr>
                    <th>Salarié</th>
                    {jours.map((j) => (
                      <th key={j} style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {j.slice(8)}
                      </th>
                    ))}
                    <th style={{ textAlign: 'right' }}>Heures</th>
                    <th style={{ textAlign: 'right' }}>Coût</th>
                  </tr>
                </thead>
                <tbody>
                  {c.salaries.map((s) => (
                    <tr key={s.employeeId ?? s.label}>
                      <td>
                        {s.label}
                        {!s.employeeId && (
                          <span className="badge warning" style={{ marginLeft: 6, fontSize: 10 }}>nom libre</span>
                        )}
                      </td>
                      {jours.map((j) => (
                        <td key={j} style={{ textAlign: 'right' }} className={s.jours[j] ? undefined : 'muted'}>
                          {s.jours[j] ? Number(s.jours[j]) : '—'}
                        </td>
                      ))}
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{Number(s.heures)}</td>
                      <td style={{ textAlign: 'right' }}>{euro(Number(s.cout))}</td>
                    </tr>
                  ))}
                  <tr>
                    <td style={{ fontWeight: 700 }}>Total</td>
                    {jours.map((j) => <td key={j} />)}
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{Number(c.totalHeures)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{euro(Number(c.totalCout))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Les anomalies n'empêchent rien : elles disent où regarder avant d'arrêter le mois. */}
          {c.anomalies > 0 && (
            <div className="card" style={{ marginTop: 16 }}>
              <h2 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={16} color="var(--accent)" />
                {c.anomalies} point{c.anomalies > 1 ? 's' : ''} à vérifier
              </h2>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {c.salaries.flatMap((s) =>
                  s.anomalies.map((a) => (
                    <li key={`${s.label}-${a}`} style={{ marginBottom: 4 }}>
                      <strong>{s.label}</strong> — {a}
                    </li>
                  )),
                )}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
