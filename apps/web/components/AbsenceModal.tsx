'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { MOTIFS_ABSENCE } from '@/lib/absences';
import { Modale } from '@/components/Modale';

interface Option { id: string; label: string }

/**
 * Pose ou correction d'une absence.
 *
 * Une absence se pose presque toujours sur une PÉRIODE — une semaine de congés, trois jours
 * d'arrêt — et jamais le week-end : le formulaire part donc d'un « du … au … » en jours ouvrés,
 * là où une saisie jour par jour demanderait cinq allers-retours.
 */
export function AbsenceModal({
  mode,
  initial,
  salaries,
  onClose,
  onSaved,
}: {
  mode: 'creation' | 'edition';
  initial: {
    id?: string;
    employeeId: string;
    kind?: string;
    debut: string;
    fin?: string;
    heures?: string;
    debutHeure?: string | null;
    finHeure?: string | null;
    commentaire?: string | null;
  };
  salaries: Option[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [employeeId, setEmployeeId] = useState(initial.employeeId);
  const [kind, setKind] = useState(initial.kind ?? 'conges');
  const [debut, setDebut] = useState(initial.debut);
  const [fin, setFin] = useState(initial.fin ?? initial.debut);
  const [joursOuvres, setJoursOuvres] = useState(true);
  const [demiJournee, setDemiJournee] = useState<'' | 'matin' | 'apres-midi'>(
    initial.debutHeure === '08:00' ? 'matin' : initial.debutHeure === '13:00' ? 'apres-midi' : '',
  );
  const [commentaire, setCommentaire] = useState(initial.commentaire ?? '');
  const [err, setErr] = useState<string | null>(null);

  const creneau = demiJournee === 'matin' ? { debut: '08:00', fin: '12:00' }
    : demiJournee === 'apres-midi' ? { debut: '13:00', fin: '17:00' }
      : null;

  const enregistrer = useMutation({
    mutationFn: () => {
      const corps = {
        kind,
        startTime: creneau?.debut ?? null,
        endTime: creneau?.fin ?? null,
        comment: commentaire.trim() || null,
      };
      if (mode === 'creation') {
        return apiFetch('/personnel/absences', {
          method: 'POST', token,
          body: { ...corps, employeeId, debut, fin, joursOuvres },
        });
      }
      return apiFetch(`/personnel/absences/${initial.id}`, {
        method: 'PATCH', token, body: { ...corps, date: debut },
      });
    },
    onSuccess: () => {
      for (const key of ['absences', 'creneaux', 'creneaux-mois', 'creneaux-chantier', 'occupation', 'conflits', 'conflits-mois']) {
        qc.invalidateQueries({ queryKey: [key] });
      }
      onSaved();
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Enregistrement impossible.'),
  });

  const valide = Boolean(employeeId && kind && debut && (mode === 'edition' || fin >= debut));

  return (
    <Modale
      titre={mode === 'creation' ? 'Poser une absence' : "Modifier l'absence"}
      onClose={onClose}
      actions={(
        <>
          <button className="btn btn-secondary" onClick={onClose}>Annuler</button>
          <button
            className="btn"
            disabled={!valide || enregistrer.isPending}
            onClick={() => { setErr(null); enregistrer.mutate(); }}
          >
            {enregistrer.isPending ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </>
      )}
    >
      <>
        {err && <div className="error" style={{ marginBottom: 12 }}>{err}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="field">
            <label>Salarié</label>
            <select
              value={employeeId}
              disabled={mode === 'edition'}
              onChange={(e) => setEmployeeId(e.target.value)}
            >
              <option value="">— Choisir —</option>
              {salaries.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Motif</label>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {MOTIFS_ABSENCE.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label>{mode === 'creation' ? 'Du' : 'Jour'}</label>
            <input type="date" value={debut} onChange={(e) => {
              setDebut(e.target.value);
              if (e.target.value > fin) setFin(e.target.value);
            }} />
          </div>
          {mode === 'creation' && (
            <div className="field">
              <label>Au (inclus)</label>
              <input type="date" value={fin} min={debut} onChange={(e) => setFin(e.target.value)} />
            </div>
          )}
        </div>

        <div className="field">
          <label>Durée</label>
          <select value={demiJournee} onChange={(e) => setDemiJournee(e.target.value as '' | 'matin' | 'apres-midi')}>
            <option value="">Journée entière</option>
            <option value="matin">Demi-journée — matin (8 h–12 h)</option>
            <option value="apres-midi">Demi-journée — après-midi (13 h–17 h)</option>
          </select>
        </div>

        {mode === 'creation' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, margin: '2px 0 12px' }}>
            <input type="checkbox" checked={joursOuvres} onChange={(e) => setJoursOuvres(e.target.checked)} />
            Jours ouvrés seulement (le week-end ne se décompte pas)
          </label>
        )}

        <div className="field">
          <label>Commentaire</label>
          <input
            value={commentaire}
            placeholder="Facultatif — n° d’arrêt, remplaçant prévu…"
            onChange={(e) => setCommentaire(e.target.value)}
          />
        </div>

      </>
    </Modale>
  );
}
