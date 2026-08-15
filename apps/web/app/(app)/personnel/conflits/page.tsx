'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { teinteChantier } from '@/components/CalendrierMois';

interface Conflit {
  employeeId: string;
  label: string;
  date: string;
  totalHeures: string;
  chantiers: Array<{
    chantierId: string; code: string; nom: string; couleur: string | null; heures: string;
  }>;
  motifs: string[];
}
interface Reponse { debut: string; fin: string; conflits: Conflit[]; total: number }

function iso(d: Date): string { return d.toISOString().slice(0, 10); }

/**
 * Les journées à vérifier, à plat.
 *
 * Rien n'est bloqué à la saisie : un salarié PEUT passer d'un chantier à l'autre dans la journée.
 * Mais si personne ne regarde, la même journée est comptée deux fois dans deux résultats — et
 * l'entreprise croit avoir dépensé ce qu'elle n'a pas dépensé.
 */
export default function ConflitsPage() {
  const { token } = useAuth();
  const [debut, setDebut] = useState(() => {
    const d = new Date(); d.setUTCDate(d.getUTCDate() - 30); return iso(d);
  });
  const [fin, setFin] = useState(() => iso(new Date()));

  const requete = useMemo(() => `debut=${debut}&fin=${fin}`, [debut, fin]);
  const conflits = useQuery({
    queryKey: ['conflits', requete],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Reponse>(`/personnel/conflits?${requete}`, { token }),
  });

  const r = conflits.data;

  return (
    <div>
      <h1 style={{ marginBottom: 4 }}>Conflits de pointage</h1>
      <p className="muted" style={{ marginTop: 0, maxWidth: 800 }}>
        Les journées où un salarié apparaît sur plusieurs chantiers, ou cumule des heures
        impossibles. Rien n’est bloqué à la saisie — passer d’un chantier à l’autre est légitime —
        mais sans relecture, la même journée est comptée deux fois dans deux résultats.
      </p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginTop: 12 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Du</label>
          <input type="date" value={debut} onChange={(e) => setDebut(e.target.value)} style={{ width: 150 }} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Au</label>
          <input type="date" value={fin} onChange={(e) => setFin(e.target.value)} style={{ width: 150 }} />
        </div>
      </div>

      {conflits.isError && (
        <p className="muted" style={{ marginTop: 16 }}>Période invalide (deux mois au maximum).</p>
      )}

      {r && r.total === 0 && (
        <div className="card" style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
          <CheckCircle2 size={18} color="var(--success)" />
          <span>Aucun conflit sur cette période.</span>
        </div>
      )}

      {r && r.total > 0 && (
        <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
          <table className="grid" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th>Date</th><th>Salarié</th><th>Chantiers</th>
                <th style={{ textAlign: 'right' }}>Heures</th><th>Motif</th>
              </tr>
            </thead>
            <tbody>
              {r.conflits.map((c) => (
                <tr key={`${c.employeeId}-${c.date}`}>
                  <td className="code-cell">{c.date}</td>
                  <td>{c.label}</td>
                  <td>
                    {c.chantiers.map((ch) => (
                      <div key={ch.chantierId} style={{
                        fontSize: 12, display: 'flex', alignItems: 'center', gap: 6,
                      }}>
                        <span style={{
                          width: 9, height: 9, borderRadius: 2, flexShrink: 0,
                          background: teinteChantier(ch.chantierId, ch.couleur),
                        }} />
                        <Link href={`/chantiers/${ch.chantierId}/calendrier`} className="link">
                          {ch.code}
                        </Link>
                        <span className="muted">{Number(ch.heures)} h</span>
                      </div>
                    ))}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{Number(c.totalHeures)}</td>
                  <td style={{ color: 'var(--danger, #dc2626)', fontSize: 12 }}>
                    <AlertTriangle size={12} style={{ verticalAlign: -2 }} /> {c.motifs.join(' · ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
