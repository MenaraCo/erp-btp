'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Copy, CornerDownRight } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CalendrierMois, CreneauCalendrier, grilleDuMois } from '@/components/CalendrierMois';
import { CalendrierSemaine } from '@/components/CalendrierSemaine';
import { LegendeChantiers } from '@/components/LegendeChantiers';
import { MenuContextuel, EntreeMenu } from '@/components/MenuContextuel';
import { CreneauModal } from '@/components/CreneauModal';
import { AbsenceModal } from '@/components/AbsenceModal';
import { libelleAbsence } from '@/lib/absences';

interface Cellule { realise: string; prevu: string; impute: boolean; multiple: boolean }
interface LigneCalendrier {
  employeeId: string | null;
  label: string;
  contractType: string | null;
  agency: string | null;
  jours: Record<string, Cellule>;
  totalRealise: string;
  totalPrevu: string;
}
interface Calendrier {
  debut: string; fin: string; jours: string[];
  salaries: LigneCalendrier[];
  totalRealise: string; totalPrevu: string;
}
interface Employee { id: string; fullName: string; contractType: string; agency: string | null }

const JOURS_COURTS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
/** Journée type proposée à la saisie. */
const HEURES_JOURNEE = 7;

type Menu =
  | { type: 'jour'; jour: string; x: number; y: number }
  | { type: 'creneau'; creneau: CreneauCalendrier & { employeeId: string }; x: number; y: number };

type Fenetre =
  | { type: 'creneau'; mode: 'creation' | 'edition'; initial: Parameters<typeof CreneauModal>[0]['initial'] }
  | { type: 'absence'; mode: 'creation' | 'edition'; initial: Parameters<typeof AbsenceModal>[0]['initial'] };

function iso(d: Date): string { return d.toISOString().slice(0, 10); }
function lundiDe(d: Date): Date {
  const c = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const j = c.getUTCDay();
  c.setUTCDate(c.getUTCDate() - (j === 0 ? 6 : j - 1));
  return c;
}
function estWeekEnd(jour: string): boolean {
  const j = new Date(`${jour}T00:00:00Z`).getUTCDay();
  return j === 0 || j === 6;
}

/**
 * Calendrier des heures : le réalisé et le prévisionnel dans la même grille.
 *
 * La saisie ligne à ligne ne montrait ni qui avait travaillé quel jour, ni où étaient les trous.
 * Ici chaque case se saisit directement, et « Dupliquer » remplit une période entière — parce
 * qu'une équipe fait souvent les mêmes journées toute la semaine, et qu'un pointage non saisi
 * vaut un résultat faux.
 */
export default function CalendrierPage() {
  const { token } = useAuth();
  const chantierId = String(useParams().chantierId);
  const qc = useQueryClient();

  const [ancre, setAncre] = useState(() => iso(new Date()));
  // Trois portées : l'agenda (semaine, mois) comme en Gestion du personnel, plus la grille de
  // saisie rapide — c'est encore le moyen le plus court de remplir une semaine d'équipe.
  const [portee, setPortee] = useState<'semaine' | 'mois' | 'saisie'>('semaine');
  const [mode, setMode] = useState<'realise' | 'prevu'>('realise');
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [fenetre, setFenetre] = useState<Fenetre | null>(null);

  const [dupSalarie, setDupSalarie] = useState('');
  const [dupHeures, setDupHeures] = useState('7');

  const { debut, fin, joursDuMois, moisIndex } = useMemo(() => {
    const d = new Date(`${ancre}T00:00:00Z`);
    if (portee !== 'mois') {
      const l = lundiDe(d);
      const f = new Date(l); f.setUTCDate(l.getUTCDate() + 6);
      return { debut: iso(l), fin: iso(f), joursDuMois: [] as string[], moisIndex: d.getUTCMonth() };
    }
    // En mois, la grille couvre des semaines entières : un mois commence rarement un lundi.
    const g = grilleDuMois(ancre);
    return { debut: g.debut, fin: g.fin, joursDuMois: g.jours, moisIndex: g.mois };
  }, [ancre, portee]);

  const cal = useQuery({
    queryKey: ['calendrier', chantierId, debut, fin],
    enabled: Boolean(token),
    queryFn: () =>
      apiFetch<Calendrier>(`/chantiers/${chantierId}/planning?debut=${debut}&fin=${fin}`, { token }),
  });
  // Les deux vues d'agenda montrent les interventions une par une, comme en Gestion du personnel.
  const creneauxMois = useQuery({
    queryKey: ['creneaux-chantier', chantierId, debut, fin],
    enabled: Boolean(token) && portee !== 'saisie',
    queryFn: () =>
      apiFetch<{ creneaux: CreneauCalendrier[] }>(
        `/personnel/creneaux?debut=${debut}&fin=${fin}&chantier=${chantierId}`,
        { token },
      ),
  });
  const deplacer = useMutation({
    mutationFn: (v: { kind: string; id: string; date: string }) =>
      apiFetch(`/personnel/creneaux/${v.kind}/${v.id}`, { method: 'PATCH', token, body: { date: v.date } }),
    onSuccess: () => { setErr(null); rafraichir(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Déplacement impossible'),
  });

  const salaries = useQuery({
    queryKey: ['employees'],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Employee[]>('/employees', { token }),
  });
  // La couleur du chantier se règle ici aussi : c'est là qu'on regarde son agenda.
  const fiche = useQuery({
    queryKey: ['chantier', chantierId],
    enabled: Boolean(token),
    queryFn: () =>
      apiFetch<{ chantier: { id: string; code: string; name: string; color: string | null } }>(
        `/chantiers/${chantierId}`, { token },
      ),
  });
  const colorier = useMutation({
    mutationFn: (v: { chantierId: string; color: string }) =>
      apiFetch(`/chantiers/${v.chantierId}/couleur`, { method: 'PATCH', token, body: { color: v.color } }),
    onSuccess: () => {
      setErr(null);
      qc.invalidateQueries({ queryKey: ['chantier', chantierId] });
      qc.invalidateQueries({ queryKey: ['chantiers'] });
      rafraichir();
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Couleur non enregistrée'),
  });

  const rafraichir = () => {
    qc.invalidateQueries({ queryKey: ['calendrier'] });
    qc.invalidateQueries({ queryKey: ['creneaux-chantier'] });
    qc.invalidateQueries({ queryKey: ['timesheets'] });
    qc.invalidateQueries({ queryKey: ['chantier-results'] });
  };

  const ecrire = useMutation({
    mutationFn: (v: { employeeId: string; date: string; hours: string }) =>
      apiFetch(`/chantiers/${chantierId}/planning/${mode === 'prevu' ? 'previsionnel' : 'realise'}`, {
        method: 'PUT', token, body: v,
      }),
    onSuccess: () => { setErr(null); rafraichir(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Saisie impossible'),
  });

  const dupliquer = useMutation({
    mutationFn: () =>
      apiFetch<{ jours: number }>(`/chantiers/${chantierId}/planning/dupliquer`, {
        method: 'POST', token,
        body: { employeeId: dupSalarie, hours: dupHeures, debut, fin, joursOuvres: true },
      }),
    onSuccess: (r) => {
      setErr(null);
      setInfo(`${r.jours} jour${r.jours > 1 ? 's' : ''} planifié${r.jours > 1 ? 's' : ''} (jours ouvrés).`);
      rafraichir();
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Duplication impossible'),
  });

  const reporter = useMutation({
    mutationFn: () =>
      apiFetch<{ crees: number }>(`/chantiers/${chantierId}/planning/reporter`, {
        method: 'POST', token, body: { debut, fin },
      }),
    onSuccess: (r) => {
      setErr(null);
      setInfo(`${r.crees} journée${r.crees > 1 ? 's' : ''} reportée${r.crees > 1 ? 's' : ''} en heures réelles. Les jours déjà pointés n’ont pas bougé.`);
      rafraichir();
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Report impossible'),
  });

  const supprimer = useMutation({
    mutationFn: (cr: CreneauCalendrier) =>
      cr.kind === 'absence'
        ? apiFetch(`/personnel/absences/${cr.id}`, { method: 'DELETE', token })
        : apiFetch(`/personnel/creneaux/${cr.kind}/${cr.id}`, { method: 'DELETE', token }),
    onSuccess: () => { setErr(null); rafraichir(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Suppression impossible'),
  });

  /** Clic droit : les mêmes gestes qu'en Gestion du personnel, mais rivés à CE chantier. */
  const entreesDuMenu = (m: Menu): EntreeMenu[] => {
    if (m.type === 'jour') {
      return [
        {
          label: 'Ajouter des heures…',
          onClick: () => setFenetre({
            type: 'creneau', mode: 'creation',
            initial: {
              kind: 'realise', employeeId: dupSalarie, chantierId, date: m.jour,
              heures: String(HEURES_JOURNEE), debut: '08:00', fin: '12:00',
            },
          }),
        },
        {
          label: 'Planifier une journée…',
          onClick: () => setFenetre({
            type: 'creneau', mode: 'creation',
            initial: {
              kind: 'prevu', employeeId: dupSalarie, chantierId, date: m.jour,
              heures: String(HEURES_JOURNEE), debut: '', fin: '',
            },
          }),
        },
        {
          label: 'Poser une absence…',
          separateurAvant: true,
          onClick: () => setFenetre({
            type: 'absence', mode: 'creation',
            initial: { employeeId: dupSalarie, debut: m.jour, fin: m.jour },
          }),
        },
      ];
    }
    const cr = m.creneau;
    if (cr.kind === 'absence') {
      return [
        {
          label: "Retirer l'absence", danger: true,
          onClick: () => supprimer.mutate(cr),
        },
      ];
    }
    return [
      {
        label: 'Modifier…',
        disabled: cr.fige,
        onClick: () => setFenetre({
          type: 'creneau', mode: 'edition',
          initial: {
            id: cr.id, kind: cr.kind as 'realise' | 'prevu', employeeId: cr.employeeId,
            chantierId, date: cr.date, heures: cr.heures, debut: cr.debut, fin: cr.fin,
            executionLineId: cr.executionLineId ?? null, codeAnalytiqueId: cr.codeAnalytiqueId ?? null,
          },
        }),
      },
      {
        label: 'Ajouter des heures ce jour…',
        onClick: () => setFenetre({
          type: 'creneau', mode: 'creation',
          initial: {
            kind: 'realise', employeeId: cr.employeeId, chantierId, date: cr.date,
            heures: '4', debut: '13:00', fin: '17:00',
          },
        }),
      },
      {
        label: cr.fige ? 'Arrêté : non supprimable' : 'Retirer du chantier',
        danger: true, disabled: cr.fige, separateurAvant: true,
        onClick: () => supprimer.mutate(cr),
      },
    ];
  };

  const decaler = (pas: number) => {
    const d = new Date(`${ancre}T00:00:00Z`);
    if (portee === 'semaine') d.setUTCDate(d.getUTCDate() + 7 * pas);
    else d.setUTCMonth(d.getUTCMonth() + pas);
    setAncre(iso(d));
  };

  const c = cal.data;

  return (
    <div>
      <h1 style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
        <CalendarDays size={20} /> Calendrier des heures
      </h1>
      <p className="muted" style={{ marginTop: 0, maxWidth: 860 }}>
        <strong>Semaine</strong> et <strong>mois</strong> sont l’agenda du chantier — le même que
        celui de la Gestion du personnel, filtré ici sur ce chantier : glissez pour déplacer,{' '}
        <strong>clic droit</strong> pour ajouter, corriger ou retirer. <strong>Saisie rapide</strong>{' '}
        garde la grille salarié × jour pour remplir une semaine entière. Le
        <strong> prévisionnel</strong> planifie les jours à venir et s’affiche en engagé ; le
        <strong> réalisé</strong> entre dans le résultat, à l’ouvrage et au code analytique choisis.
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 12 }}>
        <button className="btn btn-secondary" onClick={() => decaler(-1)}>‹ Précédent</button>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>À partir du</label>
          <input type="date" value={ancre} onChange={(e) => setAncre(e.target.value)} style={{ width: 150 }} />
        </div>
        <button className="btn btn-secondary" onClick={() => decaler(1)}>Suivant ›</button>

        <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
          {(['semaine', 'mois', 'saisie'] as const).map((p) => (
            <button key={p} className={portee === p ? 'btn' : 'btn btn-secondary'} onClick={() => setPortee(p)}>
              {p === 'semaine' ? 'Semaine' : p === 'mois' ? 'Mois' : 'Saisie rapide'}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
          {(['realise', 'prevu'] as const).map((m) => (
            <button key={m} className={mode === m ? 'btn' : 'btn btn-secondary'} onClick={() => setMode(m)}>
              {m === 'realise' ? 'Je saisis le réalisé' : 'Je planifie'}
            </button>
          ))}
        </div>
      </div>

      {err && <div className="error" style={{ marginTop: 12 }}>{err}</div>}
      {info && <div className="badge info" style={{ display: 'block', marginTop: 12, padding: '8px 10px' }}>{info}</div>}

      {/* Outils de rapidité : remplir une période d'un coup, ou entériner le plan. */}
      <div className="card" style={{ marginTop: 16, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Salarié</label>
          <select value={dupSalarie} onChange={(e) => setDupSalarie(e.target.value)} style={{ minWidth: 200 }}>
            <option value="">— Choisir —</option>
            {(salaries.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.fullName}{s.contractType === 'interimaire' ? ` · intérim${s.agency ? ` (${s.agency})` : ''}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Heures / jour</label>
          <input type="number" min={0} step="0.25" value={dupHeures}
            onChange={(e) => setDupHeures(e.target.value)} style={{ width: 100, textAlign: 'right' }} />
        </div>
        <button className="btn" disabled={!dupSalarie || dupliquer.isPending}
          onClick={() => { setInfo(null); dupliquer.mutate(); }}>
          <Copy size={14} /> {dupliquer.isPending ? 'Duplication…' : `Planifier toute la ${portee}`}
        </button>
        <button className="btn btn-secondary" disabled={reporter.isPending}
          onClick={() => { setInfo(null); reporter.mutate(); }}
          title="Reporte le prévisionnel de la période en heures réelles, sans toucher aux jours déjà pointés">
          <CornerDownRight size={14} /> {reporter.isPending ? 'Report…' : 'Tout s’est passé comme prévu'}
        </button>
      </div>

      {portee !== 'saisie' && (
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex' }}>
            {portee === 'mois' ? (
              <div style={{ flex: 1, minWidth: 0 }}>
                <CalendrierMois
                  jours={joursDuMois}
                  mois={moisIndex}
                  creneaux={creneauxMois.data?.creneaux ?? []}
                  onDeplacer={(kind, id, date) => deplacer.mutate({ kind, id, date })}
                  onMenuJour={(jour, p) => setMenu({ type: 'jour', jour, ...p })}
                  onMenuCreneau={(cr, p) => setMenu({
                    type: 'creneau', creneau: cr as CreneauCalendrier & { employeeId: string }, ...p,
                  })}
                />
              </div>
            ) : (
              <CalendrierSemaine
                jours={cal.data?.jours ?? []}
                creneaux={creneauxMois.data?.creneaux ?? []}
                onDeplacer={(kind, id, date) => deplacer.mutate({ kind, id, date })}
                onMenuJour={(jour, p) => setMenu({ type: 'jour', jour, ...p })}
                onMenuCreneau={(cr, p) => setMenu({
                  type: 'creneau', creneau: cr as CreneauCalendrier & { employeeId: string }, ...p,
                })}
              />
            )}
          </div>
          {fiche.data && (
            <LegendeChantiers
              chantiers={[fiche.data.chantier]}
              aide="Cette couleur suit le chantier dans tous les calendriers de l’entreprise."
              onChoisirCouleur={(id, color) => colorier.mutate({ chantierId: id, color })}
            />
          )}
        </div>
      )}

      {menu && (
        <MenuContextuel
          x={menu.x}
          y={menu.y}
          titre={menu.type === 'jour'
            ? new Date(`${menu.jour}T00:00:00Z`).toLocaleDateString('fr-FR', {
              weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
            })
            : `${menu.creneau.label} · ${menu.creneau.kind === 'absence'
              ? libelleAbsence(menu.creneau.motif ?? '') : menu.creneau.chantierCode}`}
          entrees={entreesDuMenu(menu)}
          onFermer={() => setMenu(null)}
        />
      )}

      {fenetre?.type === 'creneau' && (
        <CreneauModal
          mode={fenetre.mode}
          initial={fenetre.initial}
          salaries={(salaries.data ?? []).map((s) => ({ id: s.id, label: s.fullName }))}
          chantiers={[{ id: chantierId, label: fiche.data?.chantier.code ?? 'Ce chantier' }]}
          onClose={() => setFenetre(null)}
          onSaved={() => { setFenetre(null); rafraichir(); }}
        />
      )}
      {fenetre?.type === 'absence' && (
        <AbsenceModal
          mode={fenetre.mode}
          initial={fenetre.initial}
          salaries={(salaries.data ?? []).map((s) => ({ id: s.id, label: s.fullName }))}
          onClose={() => setFenetre(null)}
          onSaved={() => { setFenetre(null); rafraichir(); }}
        />
      )}

      {portee === 'saisie' && c && (
        <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="grid" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th style={{ minWidth: 180 }}>Salarié</th>
                  {c.jours.map((j) => (
                    <th key={j} style={{
                      textAlign: 'center', whiteSpace: 'nowrap',
                      background: estWeekEnd(j) ? 'var(--surface)' : undefined,
                    }}>
                      <div style={{ fontSize: 10, fontWeight: 400 }}>
                        {JOURS_COURTS[new Date(`${j}T00:00:00Z`).getUTCDay()]}
                      </div>
                      {j.slice(8)}
                    </th>
                  ))}
                  <th style={{ textAlign: 'right' }}>Réalisé</th>
                  <th style={{ textAlign: 'right' }}>Prévu</th>
                </tr>
              </thead>
              <tbody>
                {c.salaries.map((l) => (
                  <tr key={l.employeeId ?? l.label}>
                    <td>
                      {l.label}
                      {l.contractType === 'interimaire' && (
                        <span className="badge warning" style={{ marginLeft: 6, fontSize: 10 }}>
                          intérim{l.agency ? ` · ${l.agency}` : ''}
                        </span>
                      )}
                    </td>
                    {c.jours.map((j) => {
                      const cell = l.jours[j];
                      const valeur = mode === 'prevu' ? cell?.prevu : cell?.realise;
                      const fige = mode === 'realise' && (cell?.impute || cell?.multiple);
                      return (
                        <td key={j} style={{ padding: 2, background: estWeekEnd(j) ? 'var(--surface)' : undefined }}>
                          <input
                            type="number" min={0} step="0.25"
                            defaultValue={valeur && Number(valeur) !== 0 ? Number(valeur) : ''}
                            disabled={!l.employeeId || fige}
                            title={
                              cell?.impute ? 'Mois arrêté : ces heures sont figées'
                                : cell?.multiple ? 'Heures ventilées sur plusieurs ouvrages — à corriger dans le détail'
                                  : !l.employeeId ? 'Nom saisi à la main : créez la fiche salarié pour saisir ici'
                                    : undefined
                            }
                            onBlur={(e) => {
                              if (!l.employeeId) return;
                              const v = e.target.value.trim();
                              const avant = Number(valeur ?? 0);
                              if (Number(v || 0) === avant) return;
                              ecrire.mutate({ employeeId: l.employeeId, date: j, hours: v || '0' });
                            }}
                            style={{
                              width: 46, textAlign: 'right', padding: '3px 4px', fontSize: 12,
                              // Le prévisionnel se distingue du réel d'un coup d'œil.
                              color: mode === 'prevu' ? 'var(--accent)' : undefined,
                              opacity: fige ? 0.5 : 1,
                            }}
                          />
                        </td>
                      );
                    })}
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{Number(l.totalRealise)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--accent)' }}>{Number(l.totalPrevu)}</td>
                  </tr>
                ))}
                <tr>
                  <td style={{ fontWeight: 700 }}>Total</td>
                  {c.jours.map((j) => <td key={j} />)}
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{Number(c.totalRealise)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--accent)' }}>{Number(c.totalPrevu)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {c.salaries.length === 0 && (
            <p className="muted" style={{ padding: 16, margin: 0 }}>
              Aucune heure sur cette période. Utilisez « Planifier toute la {portee} » pour remplir d’un coup.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
