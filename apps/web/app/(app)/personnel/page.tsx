'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarDays, Clock, PalmtreeIcon, Pencil, Plus, Trash2 } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CalendrierMois, CreneauCalendrier, grilleDuMois, iso } from '@/components/CalendrierMois';
import { LegendeChantiers } from '@/components/LegendeChantiers';
import { MenuContextuel, EntreeMenu } from '@/components/MenuContextuel';
import { CreneauModal } from '@/components/CreneauModal';
import { AbsenceModal } from '@/components/AbsenceModal';
import { libelleAbsence } from '@/lib/absences';

interface Creneau extends CreneauCalendrier { employeeId: string }
interface Creneaux { debut: string; fin: string; jours: string[]; creneaux: Creneau[] }
interface Conflit { employeeId: string; label: string; date: string; motifs: string[] }
interface Conflits { conflits: Conflit[]; total: number }
interface Employee { id: string; fullName: string }
interface Chantier { id: string; code: string; name: string; color: string | null }

/** Journée type posée par glisser-déposer ; les heures se corrigent ensuite dans le planning. */
const HEURES_JOURNEE = 7;

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août',
  'septembre', 'octobre', 'novembre', 'décembre'];

type Menu =
  | { type: 'jour'; jour: string; x: number; y: number }
  | { type: 'creneau'; creneau: Creneau; x: number; y: number };

type Fenetre =
  | { type: 'creneau'; mode: 'creation' | 'edition'; initial: Parameters<typeof CreneauModal>[0]['initial'] }
  | { type: 'absence'; mode: 'creation' | 'edition'; initial: Parameters<typeof AbsenceModal>[0]['initial'] };

/**
 * Occupation du personnel — calendrier mensuel.
 *
 * La semaine se lit sur une ligne et le mois tient dans l'écran, comme dans un agenda. Chaque jour
 * liste ses interventions ; les journées qui posent problème (même personne à deux endroits au même
 * moment, cumul impossible, pointage pendant une absence) teintent la case.
 *
 * Tout s'édite sur place : glisser pour déplacer, clic droit pour ajouter des heures, poser une
 * absence, corriger ou retirer une intervention.
 */
export default function OccupationPage() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [ancre, setAncre] = useState(() => iso(new Date()));
  const [salarie, setSalarie] = useState('');
  const [chantier, setChantier] = useState('');
  const [contrat, setContrat] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [fenetre, setFenetre] = useState<Fenetre | null>(null);

  // La grille couvre des semaines entières : un mois commence rarement un lundi.
  const { debut, fin, jours, mois, moisAffiche } = useMemo(() => {
    const g = grilleDuMois(ancre);
    const d = new Date(`${ancre}T00:00:00Z`);
    return { ...g, moisAffiche: `${MOIS[d.getUTCMonth()]} ${d.getUTCFullYear()}` };
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

  const rafraichir = () => {
    setErr(null);
    for (const key of ['creneaux-mois', 'conflits-mois', 'occupation', 'absences', 'creneaux']) {
      qc.invalidateQueries({ queryKey: [key] });
    }
  };
  const echec = (e: unknown, defaut: string) =>
    setErr(e instanceof ApiError ? e.message : defaut);

  const deplacer = useMutation({
    mutationFn: (v: { kind: string; id: string; date: string }) =>
      apiFetch(`/personnel/creneaux/${v.kind}/${v.id}`, { method: 'PATCH', token, body: { date: v.date } }),
    onSuccess: rafraichir,
    onError: (e) => echec(e, 'Déplacement impossible'),
  });

  /** Couleur du chantier : elle vaut pour tous les calendriers, pas seulement celui-ci. */
  const colorier = useMutation({
    mutationFn: (v: { chantierId: string; color: string }) =>
      apiFetch(`/chantiers/${v.chantierId}/couleur`, { method: 'PATCH', token, body: { color: v.color } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['chantiers'] }); rafraichir(); },
    onError: (e) => echec(e, 'Couleur non enregistrée'),
  });

  /** Chantier glissé depuis la légende sur un jour : une journée prévue pour le salarié filtré. */
  const planifier = useMutation({
    mutationFn: (v: { chantierId: string; date: string }) =>
      apiFetch(`/chantiers/${v.chantierId}/planning/previsionnel`, {
        method: 'PUT', token,
        body: { employeeId: salarie, date: v.date, hours: HEURES_JOURNEE },
      }),
    onSuccess: rafraichir,
    onError: (e) => echec(e, 'Planification impossible'),
  });

  const supprimer = useMutation({
    mutationFn: (c: Creneau) =>
      c.kind === 'absence'
        ? apiFetch(`/personnel/absences/${c.id}`, { method: 'DELETE', token })
        : apiFetch(`/personnel/creneaux/${c.kind}/${c.id}`, { method: 'DELETE', token }),
    onSuccess: rafraichir,
    onError: (e) => echec(e, 'Suppression impossible'),
  });

  const deposerChantier = (chantierId: string, date: string) => {
    // Sans salarié choisi, on ne saurait pas QUI envoyer sur ce chantier : on le dit plutôt que
    // de deviner ou d'ignorer le geste en silence.
    if (!salarie) {
      setErr('Choisissez d’abord un salarié dans le filtre pour lui poser une journée.');
      return;
    }
    planifier.mutate({ chantierId, date });
  };

  const decaler = (pas: number) => {
    const d = new Date(`${ancre}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + pas, 1);
    setAncre(iso(d));
  };

  const conflitsParJour = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of conflits.data?.conflits ?? []) {
      m.set(c.date, [...(m.get(c.date) ?? []), `${c.label} — ${c.motifs.join(' · ')}`]);
    }
    return m;
  }, [conflits.data]);

  /** Chantiers réellement présents sur le mois : la légende estompe les autres. */
  const chantiersDuMois = useMemo(
    () => new Set((donnees.data?.creneaux ?? []).map((c) => c.chantierId)),
    [donnees.data],
  );

  const optionsSalaries = (salaries.data ?? []).map((s) => ({ id: s.id, label: s.fullName }));
  const optionsChantiers = (chantiers.data ?? []).map((c) => ({ id: c.id, label: `${c.code} — ${c.name}` }));

  const entreesDuMenu = (m: Menu): EntreeMenu[] => {
    if (m.type === 'jour') {
      return [
        {
          label: 'Ajouter des heures…',
          icone: <Plus size={13} />,
          onClick: () => setFenetre({
            type: 'creneau', mode: 'creation',
            initial: {
              kind: 'realise', employeeId: salarie, chantierId: chantier, date: m.jour,
              heures: String(HEURES_JOURNEE), debut: '08:00', fin: '12:00',
            },
          }),
        },
        {
          label: 'Planifier une journée…',
          icone: <Clock size={13} />,
          onClick: () => setFenetre({
            type: 'creneau', mode: 'creation',
            initial: {
              kind: 'prevu', employeeId: salarie, chantierId: chantier, date: m.jour,
              heures: String(HEURES_JOURNEE), debut: '', fin: '',
            },
          }),
        },
        {
          label: 'Poser une absence…',
          icone: <PalmtreeIcon size={13} />,
          separateurAvant: true,
          onClick: () => setFenetre({
            type: 'absence', mode: 'creation',
            initial: { employeeId: salarie, debut: m.jour, fin: m.jour },
          }),
        },
      ];
    }

    const c = m.creneau;
    if (c.kind === 'absence') {
      return [
        {
          label: "Modifier l'absence…",
          icone: <Pencil size={13} />,
          onClick: () => setFenetre({
            type: 'absence', mode: 'edition',
            initial: {
              id: c.id, employeeId: c.employeeId, kind: c.motif ?? 'conges', debut: c.date,
              debutHeure: c.debut, finHeure: c.fin, commentaire: c.commentaire ?? null,
            },
          }),
        },
        {
          label: "Retirer l'absence",
          icone: <Trash2 size={13} />,
          danger: true,
          separateurAvant: true,
          onClick: () => supprimer.mutate(c),
        },
      ];
    }

    return [
      {
        label: 'Modifier…',
        icone: <Pencil size={13} />,
        disabled: c.fige,
        onClick: () => setFenetre({
          type: 'creneau', mode: 'edition',
          initial: {
            id: c.id, kind: c.kind as 'realise' | 'prevu', employeeId: c.employeeId,
            chantierId: c.chantierId, date: c.date, heures: c.heures, debut: c.debut, fin: c.fin,
            executionLineId: c.executionLineId ?? null, codeAnalytiqueId: c.codeAnalytiqueId ?? null,
          },
        }),
      },
      {
        label: 'Ajouter des heures ce jour…',
        icone: <Plus size={13} />,
        onClick: () => setFenetre({
          type: 'creneau', mode: 'creation',
          initial: {
            kind: 'realise', employeeId: c.employeeId, chantierId: '', date: c.date,
            heures: String(HEURES_JOURNEE), debut: '13:00', fin: '17:00',
          },
        }),
      },
      {
        label: 'Poser une absence ce jour…',
        icone: <PalmtreeIcon size={13} />,
        onClick: () => setFenetre({
          type: 'absence', mode: 'creation',
          initial: { employeeId: c.employeeId, debut: c.date, fin: c.date },
        }),
      },
      {
        label: c.fige ? 'Arrêté : non supprimable' : 'Retirer du chantier',
        icone: <Trash2 size={13} />,
        danger: true,
        disabled: c.fige,
        separateurAvant: true,
        onClick: () => supprimer.mutate(c),
      },
    ];
  };

  const titreDuMenu = (m: Menu) => (m.type === 'jour'
    ? new Date(`${m.jour}T00:00:00Z`).toLocaleDateString('fr-FR', {
      weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
    })
    : `${m.creneau.label} · ${m.creneau.kind === 'absence'
      ? libelleAbsence(m.creneau.motif ?? '') : m.creneau.chantierCode}`);

  return (
    <div>
      <h1 style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
        <CalendarDays size={20} /> Occupation du personnel
      </h1>
      <p className="muted" style={{ marginTop: 0, maxWidth: 860 }}>
        Qui travaille où, tous chantiers confondus, et qui est absent. Chaque chantier a sa couleur
        (voir la légende) ; les absences sont hachurées. Glissez une intervention pour la déplacer,
        un chantier de la légende pour poser une journée, et <strong>faites un clic droit</strong>{' '}
        sur un jour ou une intervention pour ajouter, corriger ou retirer.
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

        <button
          className="btn"
          style={{ marginLeft: 'auto' }}
          onClick={() => setFenetre({
            type: 'creneau', mode: 'creation',
            initial: {
              kind: 'realise', employeeId: salarie, chantierId: chantier, date: iso(new Date()),
              heures: String(HEURES_JOURNEE), debut: '08:00', fin: '12:00',
            },
          })}
        >
          <Plus size={14} /> Heures
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => setFenetre({
            type: 'absence', mode: 'creation',
            initial: { employeeId: salarie, debut: iso(new Date()), fin: iso(new Date()) },
          })}
        >
          <PalmtreeIcon size={14} /> Absence
        </button>
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

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <CalendrierMois
            jours={jours}
            mois={mois}
            creneaux={donnees.data?.creneaux ?? []}
            conflitsParJour={conflitsParJour}
            onDeplacer={(kind, id, date) => deplacer.mutate({ kind, id, date })}
            onDeposerChantier={deposerChantier}
            onMenuJour={(jour, p) => setMenu({ type: 'jour', jour, ...p })}
            onMenuCreneau={(c, p) => setMenu({ type: 'creneau', creneau: c as Creneau, ...p })}
          />
        </div>
        <LegendeChantiers
          chantiers={chantiers.data ?? []}
          actif={chantiersDuMois}
          glissable
          aide={salarie
            ? `Glissez un chantier sur un jour : ${HEURES_JOURNEE} h prévues pour le salarié filtré.`
            : 'Choisissez un salarié pour poser des journées par glisser-déposer. Cliquez une pastille pour changer la couleur.'}
          onChoisirCouleur={(chantierId, color) => colorier.mutate({ chantierId, color })}
        />
      </div>

      {menu && (
        <MenuContextuel
          x={menu.x}
          y={menu.y}
          titre={titreDuMenu(menu)}
          entrees={entreesDuMenu(menu)}
          onFermer={() => setMenu(null)}
        />
      )}

      {fenetre?.type === 'creneau' && (
        <CreneauModal
          mode={fenetre.mode}
          initial={fenetre.initial}
          salaries={optionsSalaries}
          chantiers={optionsChantiers}
          onClose={() => setFenetre(null)}
          onSaved={() => { setFenetre(null); rafraichir(); }}
        />
      )}
      {fenetre?.type === 'absence' && (
        <AbsenceModal
          mode={fenetre.mode}
          initial={fenetre.initial}
          salaries={optionsSalaries}
          onClose={() => setFenetre(null)}
          onSaved={() => { setFenetre(null); rafraichir(); }}
        />
      )}
    </div>
  );
}
