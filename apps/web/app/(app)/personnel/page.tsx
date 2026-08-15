'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarDays } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface OccupationJour {
  date: string;
  chantiers: Array<{ chantierId: string; code: string; nom: string; heures: string; prevu: boolean }>;
  totalHeures: string;
  conflits: string[];
}
interface LignePersonnel {
  employeeId: string;
  label: string;
  contractType: string;
  agency: string | null;
  codeAnalytique: string | null;
  jours: Record<string, OccupationJour>;
  totalHeures: string;
  totalPrevu: string;
  conflits: number;
}
interface Occupation {
  debut: string; fin: string; jours: string[];
  salaries: LignePersonnel[];
  totalHeures: string; totalPrevu: string; conflits: number;
}
interface Employee { id: string; fullName: string; contractType: string }
interface Chantier { id: string; code: string; name: string }

/** Une couleur stable par chantier, pour lire la répartition d'un coup d'œil. */
const TEINTES = ['#1a3a5c', '#e8550a', '#0f766e', '#7c3aed', '#b45309', '#be123c', '#0369a1'];
function teinte(id: string): string {
  let n = 0;
  for (let i = 0; i < id.length; i += 1) n = (n + id.charCodeAt(i)) % TEINTES.length;
  return TEINTES[n];
}

function iso(d: Date): string { return d.toISOString().slice(0, 10); }
function lundiDe(d: Date): Date {
  const c = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const j = c.getUTCDay();
  c.setUTCDate(c.getUTCDate() - (j === 0 ? 6 : j - 1));
  return c;
}
const JOURS_COURTS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

/**
 * Occupation du personnel — vue d'entreprise.
 *
 * Le pointage se saisit chantier par chantier ; cette page rassemble. Chaque journée montre les
 * chantiers d'un salarié sous forme de barres colorées : on voit la répartition, les trous, et
 * les journées en conflit (même personne sur deux chantiers, ou cumul impossible).
 */
export default function OccupationPersonnelPage() {
  const { token } = useAuth();
  const [ancre, setAncre] = useState(() => iso(new Date()));
  const [portee, setPortee] = useState<'semaine' | 'mois'>('semaine');
  const [salarie, setSalarie] = useState('');
  const [chantier, setChantier] = useState('');
  const [contrat, setContrat] = useState('');

  const { debut, fin } = useMemo(() => {
    const d = new Date(`${ancre}T00:00:00Z`);
    if (portee === 'semaine') {
      const l = lundiDe(d);
      const f = new Date(l); f.setUTCDate(l.getUTCDate() + 6);
      return { debut: iso(l), fin: iso(f) };
    }
    return {
      debut: iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))),
      fin: iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))),
    };
  }, [ancre, portee]);

  const requete = useMemo(() => {
    const p = new URLSearchParams({ debut, fin });
    if (salarie) p.set('salarie', salarie);
    if (chantier) p.set('chantier', chantier);
    if (contrat) p.set('contrat', contrat);
    return p.toString();
  }, [debut, fin, salarie, chantier, contrat]);

  const vue = useQuery({
    queryKey: ['occupation', requete],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Occupation>(`/personnel/occupation?${requete}`, { token }),
  });
  const salaries = useQuery({
    queryKey: ['employees'],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Employee[]>('/employees', { token }),
  });
  const chantiers = useQuery({
    queryKey: ['chantiers'],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Chantier[]>('/chantiers', { token }),
  });

  const decaler = (pas: number) => {
    const d = new Date(`${ancre}T00:00:00Z`);
    if (portee === 'semaine') d.setUTCDate(d.getUTCDate() + 7 * pas);
    else d.setUTCMonth(d.getUTCMonth() + pas);
    setAncre(iso(d));
  };

  const v = vue.data;

  return (
    <div>
      <h1 style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
        <CalendarDays size={20} /> Occupation du personnel
      </h1>
      <p className="muted" style={{ marginTop: 0, maxWidth: 800 }}>
        Qui travaille où, tous chantiers confondus. Chaque barre est un chantier ; les journées en
        rouge demandent une vérification — même personne sur deux chantiers, ou cumul impossible.
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 12 }}>
        <button className="btn btn-secondary" onClick={() => decaler(-1)}>‹</button>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>À partir du</label>
          <input type="date" value={ancre} onChange={(e) => setAncre(e.target.value)} style={{ width: 150 }} />
        </div>
        <button className="btn btn-secondary" onClick={() => decaler(1)}>›</button>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['semaine', 'mois'] as const).map((p) => (
            <button key={p} className={portee === p ? 'btn' : 'btn btn-secondary'} onClick={() => setPortee(p)}>
              {p === 'semaine' ? 'Semaine' : 'Mois'}
            </button>
          ))}
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Salarié</label>
          <select value={salarie} onChange={(e) => setSalarie(e.target.value)} style={{ minWidth: 170 }}>
            <option value="">Tous</option>
            {(salaries.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Chantier</label>
          <select value={chantier} onChange={(e) => setChantier(e.target.value)} style={{ minWidth: 170 }}>
            <option value="">Tous</option>
            {(chantiers.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Contrat</label>
          <select value={contrat} onChange={(e) => setContrat(e.target.value)}>
            <option value="">Tous</option>
            <option value="salarie">Salariés</option>
            <option value="interimaire">Intérimaires</option>
            <option value="apprenti">Apprentis</option>
          </select>
        </div>
      </div>

      {v && v.conflits > 0 && (
        <div className="card" style={{ marginTop: 16, borderColor: 'var(--danger, #dc2626)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--danger, #dc2626)' }}>
            <AlertTriangle size={16} />
            <strong>{v.conflits} journée{v.conflits > 1 ? 's' : ''} à vérifier</strong>
          </div>
        </div>
      )}

      {v && (
        <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="grid" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th style={{ minWidth: 190 }}>Salarié</th>
                  {v.jours.map((j) => (
                    <th key={j} style={{ textAlign: 'center', minWidth: 54 }}>
                      <div style={{ fontSize: 10, fontWeight: 400 }}>
                        {JOURS_COURTS[new Date(`${j}T00:00:00Z`).getUTCDay()]}
                      </div>
                      {j.slice(8)}
                    </th>
                  ))}
                  <th style={{ textAlign: 'right' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {v.salaries.map((s) => (
                  <tr key={s.employeeId}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{s.label}</div>
                      <div className="muted" style={{ fontSize: 11 }}>
                        {s.contractType === 'interimaire' ? `Intérim${s.agency ? ` · ${s.agency}` : ''}` : '—'}
                        {s.codeAnalytique ? ` · ${s.codeAnalytique}` : ''}
                      </div>
                    </td>
                    {v.jours.map((j) => {
                      const jour = s.jours[j];
                      const enConflit = (jour?.conflits.length ?? 0) > 0;
                      return (
                        <td key={j} style={{
                          padding: 3, verticalAlign: 'top',
                          background: enConflit ? '#fef2f2' : undefined,
                        }}
                          title={enConflit ? jour.conflits.join(' — ') : undefined}
                        >
                          {/* Une barre par chantier : la hauteur dit les heures, la couleur le chantier. */}
                          {(jour?.chantiers ?? []).map((c) => (
                            <div
                              key={`${c.chantierId}-${c.prevu}`}
                              title={`${c.code} — ${c.nom} · ${Number(c.heures)} h${c.prevu ? ' (prévu)' : ''}`}
                              style={{
                                background: c.prevu ? 'transparent' : teinte(c.chantierId),
                                border: c.prevu ? `1px dashed ${teinte(c.chantierId)}` : undefined,
                                color: c.prevu ? teinte(c.chantierId) : '#fff',
                                borderRadius: 3, fontSize: 10, padding: '1px 4px', marginBottom: 2,
                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                              }}
                            >
                              {c.code} {Number(c.heures)}h
                            </div>
                          ))}
                        </td>
                      );
                    })}
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                      {Number(s.totalHeures)}
                      {Number(s.totalPrevu) > 0 && (
                        <div style={{ color: 'var(--accent)', fontWeight: 400, fontSize: 11 }}>
                          {Number(s.totalPrevu)} prévu
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {v.salaries.length === 0 && (
            <p className="muted" style={{ padding: 16, margin: 0 }}>
              Personne n’est pointé ni planifié sur cette période.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
