'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarDays } from 'lucide-react';
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
interface Creneaux { debut: string; fin: string; jours: string[]; creneaux: Creneau[] }
interface Conflit { employeeId: string; label: string; date: string; motifs: string[] }
interface Conflits { conflits: Conflit[]; total: number }
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
const EN_TETES = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août',
  'septembre', 'octobre', 'novembre', 'décembre'];

/**
 * Occupation du personnel — calendrier mensuel.
 *
 * La version précédente était un tableau qui s'étirait sur trente colonnes : il fallait le faire
 * défiler de gauche à droite pour lire un mois, ce qu'aucun calendrier ne demande. Ici, la
 * semaine se lit sur une ligne et le mois tient dans l'écran, comme dans un agenda.
 *
 * Chaque jour liste ses interventions ; celles qui posent problème (même personne à deux endroits
 * au même moment, cumul impossible) teintent la case.
 */
export default function OccupationPage() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [ancre, setAncre] = useState(() => iso(new Date()));
  const [salarie, setSalarie] = useState('');
  const [chantier, setChantier] = useState('');
  const [contrat, setContrat] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [survole, setSurvole] = useState<string | null>(null);

  // La grille couvre des semaines entières : un mois commence rarement un lundi.
  const { debut, fin, moisAffiche, semaines } = useMemo(() => {
    const d = new Date(`${ancre}T00:00:00Z`);
    const premier = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    const dernier = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    const depart = lundiDe(premier);
    const arrivee = lundiDe(dernier);
    arrivee.setUTCDate(arrivee.getUTCDate() + 6);
    const jours: string[] = [];
    for (const c = new Date(depart); c <= arrivee; c.setUTCDate(c.getUTCDate() + 1)) jours.push(iso(c));
    const paquets: string[][] = [];
    for (let i = 0; i < jours.length; i += 7) paquets.push(jours.slice(i, i + 7));
    return {
      debut: iso(depart),
      fin: iso(arrivee),
      moisAffiche: `${MOIS[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
      semaines: paquets,
    };
  }, [ancre]);

  const requete = useMemo(() => {
    const p = new URLSearchParams({ debut, fin });
    if (salarie) p.set('salarie', salarie);
    if (chantier) p.set('chantier', chantier);
    if (contrat) p.set('contrat', contrat);
    return p.toString();
  }, [debut, fin, salarie, chantier, contrat]);

  const donnees = useQuery({
    queryKey: ['creneaux-mois', requete],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Creneaux>(`/personnel/creneaux?${requete}`, { token }),
  });
  const conflits = useQuery({
    queryKey: ['conflits-mois', debut, fin],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Conflits>(`/personnel/conflits?debut=${debut}&fin=${fin}`, { token }),
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
      qc.invalidateQueries({ queryKey: ['creneaux-mois'] });
      qc.invalidateQueries({ queryKey: ['conflits-mois'] });
      qc.invalidateQueries({ queryKey: ['occupation'] });
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Déplacement impossible'),
  });

  const decaler = (pas: number) => {
    const d = new Date(`${ancre}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + pas, 1);
    setAncre(iso(d));
  };

  const parJour = useMemo(() => {
    const m = new Map<string, Creneau[]>();
    for (const c of donnees.data?.creneaux ?? []) {
      m.set(c.date, [...(m.get(c.date) ?? []), c]);
    }
    return m;
  }, [donnees.data]);

  const conflitsParJour = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of conflits.data?.conflits ?? []) {
      m.set(c.date, [...(m.get(c.date) ?? []), `${c.label} — ${c.motifs.join(' · ')}`]);
    }
    return m;
  }, [conflits.data]);

  const moisCourant = new Date(`${ancre}T00:00:00Z`).getUTCMonth();

  return (
    <div>
      <h1 style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
        <CalendarDays size={20} /> Occupation du personnel
      </h1>
      <p className="muted" style={{ marginTop: 0, maxWidth: 820 }}>
        Qui travaille où, tous chantiers confondus. Glissez une intervention sur un autre jour pour
        la déplacer ; les journées teintées demandent une vérification.
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 12 }}>
        <button className="btn btn-secondary" onClick={() => decaler(-1)}>‹</button>
        <div style={{ minWidth: 150, textAlign: 'center', fontWeight: 600, textTransform: 'capitalize' }}>
          {moisAffiche}
        </div>
        <button className="btn btn-secondary" onClick={() => decaler(1)}>›</button>
        <button className="btn btn-secondary" onClick={() => setAncre(iso(new Date()))}>Aujourd’hui</button>

        <div className="field" style={{ marginBottom: 0, marginLeft: 12 }}>
          <label>Salarié</label>
          <select value={salarie} onChange={(e) => setSalarie(e.target.value)} style={{ minWidth: 160 }}>
            <option value="">Tous</option>
            {(salaries.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Chantier</label>
          <select value={chantier} onChange={(e) => setChantier(e.target.value)} style={{ minWidth: 160 }}>
            <option value="">Tous</option>
            {(chantiers.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
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

      {err && <div className="error" style={{ marginTop: 12 }}>{err}</div>}
      {conflits.data && conflits.data.total > 0 && (
        <div className="card" style={{ marginTop: 12, borderColor: 'var(--danger, #dc2626)', padding: '10px 14px' }}>
          <span style={{ color: 'var(--danger, #dc2626)', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={16} />
            <strong>{conflits.data.total} journée{conflits.data.total > 1 ? 's' : ''} à vérifier</strong>
          </span>
        </div>
      )}

      <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
        {/* En-têtes des jours */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
          {EN_TETES.map((j) => (
            <div key={j} style={{
              padding: '8px 10px', fontSize: 11, fontWeight: 600, textAlign: 'center',
              borderBottom: '1px solid var(--border)', color: 'var(--muted)',
            }}>
              {j}
            </div>
          ))}
        </div>

        {semaines.map((semaine) => (
          <div key={semaine[0]} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
            {semaine.map((jour) => {
              const dansLeMois = new Date(`${jour}T00:00:00Z`).getUTCMonth() === moisCourant;
              const interventions = parJour.get(jour) ?? [];
              const motifs = conflitsParJour.get(jour) ?? [];
              return (
                <div
                  key={jour}
                  onDragOver={(e) => { e.preventDefault(); setSurvole(jour); }}
                  onDragLeave={() => setSurvole(null)}
                  onDrop={(e) => {
                    e.preventDefault(); setSurvole(null);
                    const [kind, id] = e.dataTransfer.getData('text/plain').split(':');
                    if (kind && id) deplacer.mutate({ kind, id, date: jour });
                  }}
                  title={motifs.join('\n') || undefined}
                  style={{
                    minHeight: 108, padding: 6, borderTop: '1px solid var(--border)',
                    borderLeft: '1px solid var(--border)',
                    background: survole === jour ? 'var(--surface)'
                      : motifs.length > 0 ? '#fef2f2'
                        : dansLeMois ? undefined : 'var(--surface)',
                    opacity: dansLeMois ? 1 : 0.6,
                  }}
                >
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    fontSize: 11, marginBottom: 4,
                  }}>
                    <span style={{ fontWeight: dansLeMois ? 600 : 400 }}>{Number(jour.slice(8))}</span>
                    {motifs.length > 0 && <AlertTriangle size={12} color="var(--danger, #dc2626)" />}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {interventions.slice(0, 4).map((c) => (
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
                          borderRadius: 4, fontSize: 10, padding: '1px 5px',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          cursor: c.fige ? 'not-allowed' : 'grab', opacity: c.fige ? 0.55 : 1,
                        }}
                      >
                        {c.debut ? `${c.debut} ` : ''}{c.chantierCode} · {c.label.split(' ')[0]}
                      </div>
                    ))}
                    {/* Une case ne peut pas tout montrer : on annonce le reste plutôt que de tronquer en silence. */}
                    {interventions.length > 4 && (
                      <div className="muted" style={{ fontSize: 10 }}>
                        + {interventions.length - 4} autre{interventions.length - 4 > 1 ? 's' : ''}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
