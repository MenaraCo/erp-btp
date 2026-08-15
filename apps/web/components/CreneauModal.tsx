'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export interface CreneauEdite {
  id: string;
  kind: 'realise' | 'prevu';
  employeeId: string;
  label: string;
  chantierId: string;
  date: string;
  heures: string;
  debut: string | null;
  fin: string | null;
  fige: boolean;
}

interface Option { id: string; label: string }

interface LigneExecution {
  id: string;
  code: string | null;
  designation: string;
  vendable: boolean;
  children?: LigneExecution[];
}
interface PlanCode { id: string; code: string; label: string }
interface PlanFamille { codes: PlanCode[] }
interface PlanLot { familles: PlanFamille[] }
interface PlanNature { nature: string; label: string; lots: PlanLot[] }

/** Aplatit l'arbre d'exécution : un sélecteur se lit mieux à plat, indenté par niveau. */
function aplatir(lignes: LigneExecution[], niveau = 0): Array<{ id: string; label: string }> {
  return lignes.flatMap((l) => [
    { id: l.id, label: `${'— '.repeat(niveau)}${l.code ? `${l.code} · ` : ''}${l.designation}` },
    ...aplatir(l.children ?? [], niveau + 1),
  ]);
}

/** Découpages courants d'une journée de chantier — un clic plutôt que quatre champs. */
const RACCOURCIS = [
  { label: 'Matin', debut: '08:00', fin: '12:00' },
  { label: 'Après-midi', debut: '13:00', fin: '17:00' },
  { label: 'Journée', debut: '08:00', fin: '17:00' },
  { label: 'Sans horaire', debut: '', fin: '' },
];

/**
 * Saisie ou correction d'une intervention.
 *
 * Le créneau horaire est le cœur de l'écran : c'est lui qui permet « 8 h–12 h ici, l'après-midi
 * là », et lui qui rend le chevauchement détectable. Les heures restent saisissables seules pour
 * les entreprises qui pointent en volume — beaucoup ne notent pas les horaires.
 */
export function CreneauModal({
  mode,
  initial,
  salaries,
  chantiers,
  onClose,
  onSaved,
}: {
  mode: 'creation' | 'edition';
  initial: {
    id?: string;
    kind: 'realise' | 'prevu';
    employeeId: string;
    chantierId: string;
    date: string;
    heures?: string;
    debut?: string | null;
    fin?: string | null;
    executionLineId?: string | null;
    codeAnalytiqueId?: string | null;
  };
  salaries: Option[];
  chantiers: Option[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [kind, setKind] = useState<'realise' | 'prevu'>(initial.kind);
  const [employeeId, setEmployeeId] = useState(initial.employeeId);
  const [chantierId, setChantierId] = useState(initial.chantierId);
  const [date, setDate] = useState(initial.date);
  const [debut, setDebut] = useState(initial.debut ?? '');
  const [fin, setFin] = useState(initial.fin ?? '');
  const [heures, setHeures] = useState(initial.heures ?? '7');
  const [ouvrage, setOuvrage] = useState(initial.executionLineId ?? '');
  const [codeAnalytique, setCodeAnalytique] = useState(initial.codeAnalytiqueId ?? '');
  const [err, setErr] = useState<string | null>(null);

  // Ouvrages du chantier choisi : c'est là que se joue le coût réel d'une prestation. Sans cette
  // imputation, on sait ce qu'a coûté le chantier, jamais ce qu'a coûté l'ouvrage.
  const ouvrages = useQuery({
    queryKey: ['execution-tree', chantierId],
    enabled: Boolean(token && chantierId && kind === 'realise'),
    retry: false,
    queryFn: () => apiFetch<LigneExecution[]>(`/chantiers/${chantierId}/execution-tree`, { token }),
  });
  const plan = useQuery({
    queryKey: ['analytical-plan'],
    enabled: Boolean(token && kind === 'realise'),
    queryFn: () => apiFetch<PlanNature[]>('/analytical/plan', { token }),
  });

  const optionsOuvrages = aplatir(ouvrages.data ?? []);
  const optionsCodes = (plan.data ?? []).flatMap((n) =>
    n.lots.flatMap((l) => l.familles.flatMap((f) =>
      f.codes.map((c) => ({ id: c.id, label: `${c.code} — ${c.label}` })))));

  const horodate = Boolean(debut && fin);

  const enregistrer = useMutation({
    mutationFn: () => {
      const corps = {
        employeeId,
        chantierId,
        date,
        debut: debut || null,
        fin: fin || null,
        heures: horodate ? null : heures,
        // Le prévisionnel ne s'impute pas : il n'a pas encore de coût à rattacher.
        executionLineId: kind === 'realise' ? (ouvrage || null) : null,
        codeAnalytiqueId: kind === 'realise' ? (codeAnalytique || null) : null,
      };
      if (mode === 'creation') {
        return apiFetch('/personnel/creneaux', { method: 'POST', token, body: { kind, ...corps } });
      }
      return apiFetch(`/personnel/creneaux/${initial.kind}/${initial.id}`, {
        method: 'PATCH', token,
        // Le salarié ne se change pas ici : ce serait une autre intervention, pas une correction.
        body: {
          chantierId, date, debut: debut || null, fin: fin || null,
          heures: horodate ? null : heures,
          ...(initial.kind === 'realise'
            ? { executionLineId: ouvrage || null, codeAnalytiqueId: codeAnalytique || null }
            : {}),
        },
      });
    },
    onSuccess: () => {
      for (const key of ['creneaux', 'creneaux-mois', 'creneaux-chantier', 'occupation', 'conflits', 'conflits-mois', 'calendrier', 'timesheets', 'chantier-results']) {
        qc.invalidateQueries({ queryKey: [key] });
      }
      onSaved();
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Enregistrement impossible.'),
  });

  const valide = Boolean(employeeId && chantierId && date && (horodate || Number(heures) > 0));

  return (
    <div className="modal-overlay" style={overlay} onClick={onClose}>
      <div className="modal-box" style={panel} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <strong style={{ fontSize: 16 }}>
            {mode === 'creation' ? 'Ajouter des heures' : "Modifier l'intervention"}
          </strong>
          <button className="btn btn-ghost" onClick={onClose} style={{ fontSize: 18 }}>✕</button>
        </div>

        {err && <div className="error" style={{ marginBottom: 12 }}>{err}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="field">
            <label>Salarié</label>
            <select
              value={employeeId}
              disabled={mode === 'edition'}
              title={mode === 'edition' ? 'Pour changer de personne, supprimez et recréez' : undefined}
              onChange={(e) => setEmployeeId(e.target.value)}
            >
              <option value="">— Choisir —</option>
              {salaries.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Chantier</label>
            <select value={chantierId} onChange={(e) => setChantierId(e.target.value)}>
              <option value="">— Choisir —</option>
              {chantiers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Jour</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field">
            <label>Nature</label>
            <select
              value={kind}
              disabled={mode === 'edition'}
              title={mode === 'edition' ? 'Le prévisionnel se transforme en réalisé depuis le calendrier du chantier' : undefined}
              onChange={(e) => setKind(e.target.value as 'realise' | 'prevu')}
            >
              <option value="realise">Réalisé (compte dans le résultat)</option>
              <option value="prevu">Prévisionnel (planifié)</option>
            </select>
          </div>
        </div>

        {kind === 'realise' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field">
              <label>Ouvrage</label>
              <select
                value={ouvrage}
                disabled={!chantierId || optionsOuvrages.length === 0}
                onChange={(e) => setOuvrage(e.target.value)}
              >
                <option value="">— Sans ouvrage —</option>
                {optionsOuvrages.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Code analytique</label>
              <select value={codeAnalytique} onChange={(e) => setCodeAnalytique(e.target.value)}>
                <option value="">— Celui de la fiche salarié —</option>
                {optionsCodes.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '4px 0 12px' }}>
          {RACCOURCIS.map((r) => (
            <button
              key={r.label}
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: 11, padding: '4px 10px' }}
              onClick={() => { setDebut(r.debut); setFin(r.fin); }}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <div className="field">
            <label>De</label>
            <input type="time" value={debut} onChange={(e) => setDebut(e.target.value)} />
          </div>
          <div className="field">
            <label>À</label>
            <input type="time" value={fin} onChange={(e) => setFin(e.target.value)} />
          </div>
          <div className="field">
            <label>Heures</label>
            <input
              type="number" min={0} step="0.25"
              value={horodate ? dureeEnHeures(debut, fin) : heures}
              disabled={horodate}
              title={horodate ? 'Déduites du créneau horaire' : undefined}
              onChange={(e) => setHeures(e.target.value)}
              style={{ textAlign: 'right' }}
            />
          </div>
        </div>
        <p className="muted" style={{ fontSize: 11, marginTop: 0 }}>
          Avec un créneau horaire, la durée est déduite et un chevauchement devient détectable.
          Sans horaire, seul le volume d’heures est enregistré.
          {kind === 'realise' && ' L’ouvrage donne le coût réel de la prestation ; le code analytique, celui du poste.'}
        </p>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn btn-secondary" onClick={onClose}>Annuler</button>
          <button
            className="btn"
            disabled={!valide || enregistrer.isPending}
            onClick={() => { setErr(null); enregistrer.mutate(); }}
          >
            {enregistrer.isPending ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
}

function dureeEnHeures(debut: string, fin: string): string {
  const min = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
  const d = (min(fin) - min(debut)) / 60;
  return d > 0 ? String(Math.round(d * 100) / 100) : '0';
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', zIndex: 1100,
  display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 20px',
  overflowY: 'auto',
};
const panel: React.CSSProperties = {
  borderRadius: 12, padding: '22px 26px', width: 560, maxWidth: '100%',
};
