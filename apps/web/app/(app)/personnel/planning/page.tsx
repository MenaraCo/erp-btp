'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarRange } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { teinteChantier } from '@/components/CalendrierMois';
import { LegendeChantiers } from '@/components/LegendeChantiers';

interface Creneau {
  id: string;
  kind: 'realise' | 'prevu';
  employeeId: string;
  label: string;
  chantierId: string;
  chantierCode: string;
  chantierNom: string;
  chantierCouleur: string | null;
  date: string;
  heures: string;
  debut: string | null;
  fin: string | null;
  fige: boolean;
}
interface Reponse { debut: string; fin: string; jours: string[]; creneaux: Creneau[] }
interface Employee { id: string; fullName: string }
interface Chantier { id: string; code: string; name: string; color: string | null }

/** Journée type posée par glisser-déposer depuis la légende. */
const HEURES_JOURNEE = 7;

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

  const rafraichir = () => {
    setErr(null);
    qc.invalidateQueries({ queryKey: ['creneaux'] });
    qc.invalidateQueries({ queryKey: ['occupation'] });
    qc.invalidateQueries({ queryKey: ['calendrier'] });
  };

  const colorier = useMutation({
    mutationFn: (v: { chantierId: string; color: string }) =>
      apiFetch(`/chantiers/${v.chantierId}/couleur`, { method: 'PATCH', token, body: { color: v.color } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chantiers'] });
      rafraichir();
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Couleur non enregistrée'),
  });

  const planifier = useMutation({
    mutationFn: (v: { chantierId: string; date: string }) =>
      apiFetch(`/chantiers/${v.chantierId}/planning/previsionnel`, {
        method: 'PUT', token,
        body: { employeeId: salarie, date: v.date, hours: HEURES_JOURNEE },
      }),
    onSuccess: rafraichir,
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Planification impossible'),
  });

  /**
   * Dépôt sur une colonne-jour : soit une intervention qu'on déplace, soit un chantier venu de la
   * légende, qu'on pose comme journée prévue pour le salarié filtré.
   */
  const deposer = (charge: string, jour: string) => {
    const [kind, id] = charge.split(':');
    if (!kind || !id) return;
    if (kind !== 'chantier') { deplacer.mutate({ kind, id, date: jour }); return; }
    if (!salarie) {
      setErr('Choisissez d’abord un salarié dans le filtre pour lui poser une journée.');
      return;
    }
    planifier.mutate({ chantierId: id, date: jour });
  };

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
        background: c.kind === 'prevu' ? 'transparent' : teinteChantier(c.chantierId, c.chantierCouleur),
        border: `1px ${c.kind === 'prevu' ? 'dashed' : 'solid'} ${teinteChantier(c.chantierId, c.chantierCouleur)}`,
        color: c.kind === 'prevu' ? teinteChantier(c.chantierId, c.chantierCouleur) : '#fff',
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
        Chaque bloc est une intervention, à la couleur de son chantier. Faites-le{' '}
        <strong>glisser sur un autre jour</strong> pour le déplacer, ou glissez un chantier de la
        légende pour poser une journée. Traits pleins : réalisé ; pointillés : prévisionnel.
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
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'auto', flex: 1, minWidth: 0 }}>
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
                    deposer(e.dataTransfer.getData('text/plain'), j);
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
                    deposer(e.dataTransfer.getData('text/plain'), j);
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
        <LegendeChantiers
          chantiers={chantiers.data ?? []}
          actif={new Set(r.creneaux.map((c) => c.chantierId))}
          glissable
          aide={salarie
            ? `Glissez un chantier sur un jour : ${HEURES_JOURNEE} h prévues pour le salarié filtré.`
            : 'Choisissez un salarié pour poser des journées par glisser-déposer. Cliquez une pastille pour changer la couleur.'}
          onChoisirCouleur={(chantierId, color) => colorier.mutate({ chantierId, color })}
        />
        </div>
      )}
    </div>
  );
}
