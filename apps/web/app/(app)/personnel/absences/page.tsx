'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PalmtreeIcon, Pencil, Plus, Trash2 } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { LigneVide } from '@/components/ui';
import { AbsenceModal } from '@/components/AbsenceModal';
import { IconBtn } from '@/components/IconBtn';
import { MOTIFS_ABSENCE, couleurAbsence, libelleAbsence } from '@/lib/absences';

interface Absence {
  id: string;
  employeeId: string;
  label: string;
  kind: string;
  date: string;
  heures: string;
  debut: string | null;
  fin: string | null;
  commentaire: string | null;
}
interface Employee { id: string; fullName: string }

function iso(d: Date): string { return d.toISOString().slice(0, 10); }

/**
 * Congés et absences — la liste, à côté du calendrier.
 *
 * Le calendrier montre une journée ; cette page répond aux questions de gestion : combien de jours
 * de congés cette personne a-t-elle pris ce trimestre, qui est en arrêt, quels jours d'intempéries
 * ont arrêté les chantiers. D'où le regroupement par salarié et le total en jours.
 */
export default function AbsencesPage() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [debut, setDebut] = useState(() => {
    const d = new Date(); d.setUTCMonth(d.getUTCMonth() - 1, 1); return iso(d);
  });
  const [fin, setFin] = useState(() => {
    const d = new Date(); d.setUTCMonth(d.getUTCMonth() + 2, 0); return iso(d);
  });
  const [salarie, setSalarie] = useState('');
  const [motif, setMotif] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [fenetre, setFenetre] = useState<null | {
    mode: 'creation' | 'edition';
    initial: Parameters<typeof AbsenceModal>[0]['initial'];
  }>(null);

  const requete = useMemo(() => {
    const p = new URLSearchParams({ debut, fin });
    if (salarie) p.set('salarie', salarie);
    return p.toString();
  }, [debut, fin, salarie]);

  const absences = useQuery({
    queryKey: ['absences', requete],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Absence[]>(`/personnel/absences?${requete}`, { token }),
  });
  const salaries = useQuery({
    queryKey: ['employees'], enabled: Boolean(token),
    queryFn: () => apiFetch<Employee[]>('/employees', { token }),
  });

  const supprimer = useMutation({
    mutationFn: (id: string) => apiFetch(`/personnel/absences/${id}`, { method: 'DELETE', token }),
    onSuccess: () => {
      setErr(null);
      for (const key of ['absences', 'creneaux', 'creneaux-mois', 'occupation', 'conflits', 'conflits-mois']) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Suppression impossible'),
  });

  const lignes = (absences.data ?? []).filter((a) => !motif || a.kind === motif);

  /** Récapitulatif par salarié : ce que la liste jour par jour ne dit pas. */
  const parSalarie = useMemo(() => {
    const m = new Map<string, { label: string; jours: number; parMotif: Map<string, number> }>();
    for (const a of lignes) {
      const s = m.get(a.employeeId) ?? { label: a.label, jours: 0, parMotif: new Map() };
      // Une demi-journée compte pour une demi-journée : c'est ce que la paye décompte.
      const part = a.debut && a.fin ? 0.5 : 1;
      s.jours += part;
      s.parMotif.set(a.kind, (s.parMotif.get(a.kind) ?? 0) + part);
      m.set(a.employeeId, s);
    }
    return [...m.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [lignes]);

  const optionsSalaries = (salaries.data ?? []).map((s) => ({ id: s.id, label: s.fullName }));

  return (
    <div>
      <h1 style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
        <PalmtreeIcon size={20} /> Congés et absences
      </h1>
      <p className="muted" style={{ marginTop: 0, maxWidth: 820 }}>
        Congés, arrêts, intempéries, formation… Une absence ne coûte rien à un chantier : elle dit
        seulement que la personne n’est pas disponible — et le planning cesse ainsi de promettre
        quelqu’un qui ne viendra pas.
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 12 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Du</label>
          <input type="date" value={debut} onChange={(e) => setDebut(e.target.value)} style={{ width: 150 }} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Au</label>
          <input type="date" value={fin} onChange={(e) => setFin(e.target.value)} style={{ width: 150 }} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Salarié</label>
          <select value={salarie} onChange={(e) => setSalarie(e.target.value)} style={{ minWidth: 170 }}>
            <option value="">Tous</option>
            {optionsSalaries.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Motif</label>
          <select value={motif} onChange={(e) => setMotif(e.target.value)} style={{ minWidth: 170 }}>
            <option value="">Tous</option>
            {MOTIFS_ABSENCE.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
          </select>
        </div>
        <button
          className="btn"
          style={{ marginLeft: 'auto' }}
          onClick={() => setFenetre({
            mode: 'creation',
            initial: { employeeId: salarie, debut: iso(new Date()), fin: iso(new Date()) },
          })}
        >
          <Plus size={14} /> Poser une absence
        </button>
      </div>

      {err && <div className="error" style={{ marginTop: 12 }}>{err}</div>}

      {parSalarie.length > 0 && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
          {parSalarie.map((s) => (
            <div key={s.label} className="card" style={{ padding: '10px 14px', minWidth: 190 }}>
              <div style={{ fontWeight: 600, fontSize: 12 }}>{s.label}</div>
              <div style={{ fontSize: 20, fontWeight: 600, margin: '2px 0 4px' }}>
                {s.jours} <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>jour{s.jours > 1 ? 's' : ''}</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {[...s.parMotif.entries()].map(([k, n]) => (
                  <span key={k} style={{
                    fontSize: 10, padding: '1px 6px', borderRadius: 10,
                    border: `1px solid ${couleurAbsence(k)}`, color: couleurAbsence(k),
                  }}>
                    {libelleAbsence(k)} {n}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
        <table className="grid" style={{ margin: 0 }}>
          <thead>
            <tr>
              <th style={{ width: 110 }}>Date</th>
              <th>Salarié</th>
              <th>Motif</th>
              <th style={{ width: 130 }}>Durée</th>
              <th>Commentaire</th>
              <th style={{ width: 70 }} />
            </tr>
          </thead>
          <tbody>
            {lignes.map((a) => (
              <tr key={a.id}>
                <td className="code-cell">{a.date}</td>
                <td>{a.label}</td>
                <td>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    fontSize: 12, color: couleurAbsence(a.kind), fontWeight: 600,
                  }}>
                    <span style={{
                      width: 9, height: 9, borderRadius: 2, background: couleurAbsence(a.kind),
                    }} />
                    {libelleAbsence(a.kind)}
                  </span>
                </td>
                <td style={{ fontSize: 12 }}>
                  {a.debut && a.fin ? `${a.debut}–${a.fin}` : `${Number(a.heures)} h`}
                </td>
                <td className="muted" style={{ fontSize: 12 }}>{a.commentaire ?? '—'}</td>
                <td style={{ textAlign: 'right', paddingRight: 8, whiteSpace: 'nowrap' }}>
                  <IconBtn
                    title="Modifier"
                    color="var(--muted)"
                    onClick={() => setFenetre({
                      mode: 'edition',
                      initial: {
                        id: a.id, employeeId: a.employeeId, kind: a.kind, debut: a.date,
                        debutHeure: a.debut, finHeure: a.fin, commentaire: a.commentaire,
                      },
                    })}
                  >
                    <Pencil size={13} />
                  </IconBtn>
                  <IconBtn
                    title="Retirer cette absence"
                    color="var(--danger, #dc2626)"
                    onClick={() => supprimer.mutate(a.id)}
                  >
                    <Trash2 size={13} />
                  </IconBtn>
                </td>
              </tr>
            ))}
            {lignes.length === 0 && (
              <LigneVide
                colonnes={6}
                icone={PalmtreeIcon}
                titre="Aucune absence sur cette période."
                indice="« Poser une absence » enregistre un congé ou un arrêt : les heures prévues du salarié s’effacent d’autant."
              />
            )}
          </tbody>
        </table>
      </div>

      {fenetre && (
        <AbsenceModal
          mode={fenetre.mode}
          initial={fenetre.initial}
          salaries={optionsSalaries}
          onClose={() => setFenetre(null)}
          onSaved={() => setFenetre(null)}
        />
      )}
    </div>
  );
}
