'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarRange } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface Creneau {
  id: string;
  kind: 'realise' | 'prevu';
  employeeId: string;
  label: string;
  chantierId: string;
  chantierCode: string;
  chantierNom: string;
  date: string;
  heures: string;
  debut: string | null;
  fin: string | null;
  fige: boolean;
}
interface Reponse { debut: string; fin: string; jours: string[]; creneaux: Creneau[] }
interface Employee { id: string; fullName: string }
interface Chantier { id: string; code: string; name: string }

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
const JOURS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
/** Amplitude affichée : au-delà, la grille s'étire pour rien. */
const HEURE_DEBUT = 6;
const HEURE_FIN = 20;
const HAUTEUR_HEURE = 34;

function minutes(h: string): number {
  return Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
}

/**
 * Planning hebdomadaire — vue par tranches horaires.
 *
 * Les heures sans horaire précis restent affichées en haut de colonne (bandeau « journée ») :
 * beaucoup d'entreprises pointent en volume, et les exclure de la vue les rendrait invisibles.
 * Les créneaux horodatés se placent à leur place réelle, ce qui montre les chevauchements à l'œil.
 *
 * Le glisser-déposer déplace un créneau d'un jour à l'autre — le geste le plus fréquent quand on
 * réorganise une semaine.
 */
export default function PlanningPage() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [ancre, setAncre] = useState(() => iso(new Date()));
  const [salarie, setSalarie] = useState('');
  const [chantier, setChantier] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [survole, setSurvole] = useState<string | null>(null);

  const { debut, fin } = useMemo(() => {
    const l = lundiDe(new Date(`${ancre}T00:00:00Z`));
    const f = new Date(l); f.setUTCDate(l.getUTCDate() + 6);
    return { debut: iso(l), fin: iso(f) };
  }, [ancre]);

  const requete = useMemo(() => {
    const p = new URLSearchParams({ debut, fin });
    if (salarie) p.set('salarie', salarie);
    if (chantier) p.set('chantier', chantier);
    return p.toString();
  }, [debut, fin, salarie, chantier]);

  const donnees = useQuery({
    queryKey: ['creneaux', requete],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Reponse>(`/personnel/creneaux?${requete}`, { token }),
  });
  const salaries = useQuery({
    queryKey: ['employees'], enabled: Boolean(token),
    queryFn: () => apiFetch<Employee[]>('/employees', { token }),
  });
  const chantiers = useQuery({
    queryKey: ['chantiers'], enabled: Boolean(token),
    queryFn: () => apiFetch<Chantier[]>('/chantiers', { token }),
  });

  const deplacer = useMutation({
    mutationFn: (v: { kind: string; id: string; date: string }) =>
      apiFetch(`/personnel/creneaux/${v.kind}/${v.id}`, { method: 'PATCH', token, body: { date: v.date } }),
    onSuccess: () => {
      setErr(null);
      qc.invalidateQueries({ queryKey: ['creneaux'] });
      qc.invalidateQueries({ queryKey: ['occupation'] });
      qc.invalidateQueries({ queryKey: ['calendrier'] });
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Déplacement impossible'),
  });

  const decaler = (pas: number) => {
    const d = new Date(`${ancre}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 7 * pas);
    setAncre(iso(d));
  };

  const r = donnees.data;
  const heures = Array.from({ length: HEURE_FIN - HEURE_DEBUT }, (_, i) => HEURE_DEBUT + i);

  const bloc = (c: Creneau, style: React.CSSProperties) => (
    <div
      key={c.id}
      draggable={!c.fige}
      onDragStart={(e) => e.dataTransfer.setData('text/plain', `${c.kind}:${c.id}`)}
      title={`${c.label} · ${c.chantierCode} — ${c.chantierNom}\n${
        c.debut ? `${c.debut}–${c.fin}` : `${Number(c.heures)} h`
      }${c.kind === 'prevu' ? ' (prévu)' : ''}${c.fige ? '\nArrêté : non déplaçable' : ''}`}
      style={{
        background: c.kind === 'prevu' ? 'transparent' : teinte(c.chantierId),
        border: `1px ${c.kind === 'prevu' ? 'dashed' : 'solid'} ${teinte(c.chantierId)}`,
        color: c.kind === 'prevu' ? teinte(c.chantierId) : '#fff',
        borderRadius: 4, fontSize: 10, padding: '1px 4px', overflow: 'hidden',
        cursor: c.fige ? 'not-allowed' : 'grab', opacity: c.fige ? 0.55 : 1,
        ...style,
      }}
    >
      <div style={{ fontWeight: 600, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
        {c.chantierCode}
      </div>
      <div style={{ whiteSpace: 'nowrap', overflow: 'hidden' }}>{c.label}</div>
    </div>
  );

  return (
    <div>
      <h1 style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
        <CalendarRange size={20} /> Planning de la semaine
      </h1>
      <p className="muted" style={{ marginTop: 0, maxWidth: 820 }}>
        Chaque bloc est une intervention. Faites-le <strong>glisser sur un autre jour</strong> pour
        le déplacer. Les traits pleins sont du réalisé, les pointillés du prévisionnel.
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 12 }}>
        <button className="btn btn-secondary" onClick={() => decaler(-1)}>‹</button>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Semaine du</label>
          <input type="date" value={ancre} onChange={(e) => setAncre(e.target.value)} style={{ width: 150 }} />
        </div>
        <button className="btn btn-secondary" onClick={() => decaler(1)}>›</button>
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
            {(chantiers.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
          </select>
        </div>
      </div>

      {err && <div className="error" style={{ marginTop: 12 }}>{err}</div>}

      {r && (
        <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: `56px repeat(${r.jours.length}, minmax(110px, 1fr))` }}>
            {/* En-têtes */}
            <div style={{ borderBottom: '1px solid var(--border)' }} />
            {r.jours.map((j) => (
              <div key={j} style={{
                borderBottom: '1px solid var(--border)', borderLeft: '1px solid var(--border)',
                padding: '6px 8px', fontSize: 11, fontWeight: 600, textAlign: 'center',
              }}>
                {JOURS[new Date(`${j}T00:00:00Z`).getUTCDay()]}
                <div className="muted" style={{ fontWeight: 400 }}>{j.slice(8)}/{j.slice(5, 7)}</div>
              </div>
            ))}

            {/* Bandeau « journée » : les heures sans horaire précis, qui existent quand même. */}
            <div style={{ fontSize: 10, padding: '4px 6px', color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
              journée
            </div>
            {r.jours.map((j) => {
              const sansHoraire = r.creneaux.filter((c) => c.date === j && !c.debut);
              return (
                <div
                  key={`allday-${j}`}
                  onDragOver={(e) => { e.preventDefault(); setSurvole(j); }}
                  onDragLeave={() => setSurvole(null)}
                  onDrop={(e) => {
                    e.preventDefault(); setSurvole(null);
                    const [kind, id] = e.dataTransfer.getData('text/plain').split(':');
                    if (kind && id) deplacer.mutate({ kind, id, date: j });
                  }}
                  style={{
                    borderLeft: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
                    padding: 3, minHeight: 30, display: 'flex', flexDirection: 'column', gap: 2,
                    background: survole === j ? 'var(--surface)' : undefined,
                  }}
                >
                  {sansHoraire.map((c) => bloc(c, { position: 'relative' }))}
                </div>
              );
            })}

            {/* Grille horaire */}
            <div>
              {heures.map((h) => (
                <div key={h} style={{ height: HAUTEUR_HEURE, fontSize: 10, color: 'var(--muted)', padding: '2px 6px' }}>
                  {String(h).padStart(2, '0')}:00
                </div>
              ))}
            </div>
            {r.jours.map((j) => {
              const horodates = r.creneaux.filter((c) => c.date === j && c.debut && c.fin);
              return (
                <div
                  key={`col-${j}`}
                  onDragOver={(e) => { e.preventDefault(); setSurvole(j); }}
                  onDragLeave={() => setSurvole(null)}
                  onDrop={(e) => {
                    e.preventDefault(); setSurvole(null);
                    const [kind, id] = e.dataTransfer.getData('text/plain').split(':');
                    if (kind && id) deplacer.mutate({ kind, id, date: j });
                  }}
                  style={{
                    position: 'relative', borderLeft: '1px solid var(--border)',
                    height: heures.length * HAUTEUR_HEURE,
                    background: survole === j ? 'var(--surface)' : undefined,
                  }}
                >
                  {heures.map((h) => (
                    <div key={h} style={{
                      position: 'absolute', top: (h - HEURE_DEBUT) * HAUTEUR_HEURE, left: 0, right: 0,
                      borderTop: '1px solid var(--border)', opacity: 0.5,
                    }} />
                  ))}
                  {horodates.map((c) => {
                    const haut = ((minutes(c.debut!) - HEURE_DEBUT * 60) / 60) * HAUTEUR_HEURE;
                    const hauteur = ((minutes(c.fin!) - minutes(c.debut!)) / 60) * HAUTEUR_HEURE;
                    return bloc(c, {
                      position: 'absolute', top: Math.max(0, haut), height: Math.max(16, hauteur),
                      left: 2, right: 2,
                    });
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
