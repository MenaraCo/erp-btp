'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays, ChevronLeft, ChevronRight, Download, FileText, List, PalmtreeIcon, Pencil, Plus, Trash2,
} from 'lucide-react';
import { apiFetch, apiDownload, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { downloadStyledXlsx, SheetCell, StyledCell } from '@/lib/xlsx';
import { Alerte, Bouton, CarteKpi, LigneVide } from '@/components/ui';
import { AbsenceModal } from '@/components/AbsenceModal';
import { AbsenceCalendrier, CalendrierAbsences } from '@/components/CalendrierAbsences';
import { IconBtn } from '@/components/IconBtn';
import { MOTIFS_ABSENCE, couleurAbsence, libelleAbsence } from '@/lib/absences';

interface Employee { id: string; fullName: string; code: string }

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function moisCourant(): string { return iso(new Date()).slice(0, 7); }
function libelleMois(m: string): string {
  const [a, mo] = m.split('-').map(Number);
  return new Date(a, mo - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}
/** Bornes d'un mois, élargies aux semaines entières : le calendrier montre les jours voisins. */
function bornes(mois: string): { debut: string; fin: string } {
  const [a, mo] = mois.split('-').map(Number);
  const premier = new Date(a, mo - 1, 1);
  const decalage = (premier.getDay() + 6) % 7;
  const debut = new Date(a, mo - 1, 1 - decalage);
  const fin = new Date(a, mo, 0);
  fin.setDate(fin.getDate() + (7 - ((fin.getDay() + 6) % 7) - 1));
  return { debut: iso(debut), fin: iso(fin) };
}
function decalerMois(mois: string, pas: number): string {
  const [a, mo] = mois.split('-').map(Number);
  const d = new Date(a, mo - 1 + pas, 1);
  return iso(d).slice(0, 7);
}

/**
 * Congés et absences — un mois posé à plat, comme un agenda.
 *
 * La liste répondait à « qui, quand » ; elle ne répondait pas à la question qu'on se pose devant un
 * planning : QUELLE SEMAINE est dégarnie. Le calendrier le montre d'un coup d'œil, la liste reste
 * disponible pour vérifier ligne à ligne, et le récapitulatif par salarié donne les totaux — ceux
 * qui partent en paye.
 */
export default function AbsencesPage() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [mois, setMois] = useState(moisCourant);
  const [vue, setVue] = useState<'calendrier' | 'liste'>('calendrier');
  const [salarie, setSalarie] = useState('');
  const [motif, setMotif] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [fenetre, setFenetre] = useState<null | {
    mode: 'creation' | 'edition';
    initial: Parameters<typeof AbsenceModal>[0]['initial'];
  }>(null);

  const periode = useMemo(() => bornes(mois), [mois]);
  const requete = useMemo(() => {
    const p = new URLSearchParams(periode);
    if (salarie) p.set('salarie', salarie);
    if (motif) p.set('motif', motif);
    return p.toString();
  }, [periode, salarie, motif]);

  const absences = useQuery({
    queryKey: ['absences', requete],
    enabled: Boolean(token),
    queryFn: () => apiFetch<AbsenceCalendrier[]>(`/personnel/absences?${requete}`, { token }),
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

  const lignes = absences.data ?? [];

  /** Récapitulatif par salarié : ce que la vue jour par jour ne dit pas. */
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

  const totalJours = parSalarie.reduce((s, p) => s + p.jours, 0);

  const exporterExcel = () => {
    const entete = (v: string): StyledCell => ({ v, s: 'header' });
    const rows: SheetCell[][] = [
      [{ v: `Relevé d’absences — ${libelleMois(mois)}`, s: 'title' }],
      [{ v: `Période du ${periode.debut} au ${periode.fin}`, s: 'value' }],
      [],
      ['Salarié', 'Date', 'Motif', 'Durée', 'Commentaire'].map(entete),
    ];
    for (const a of lignes) {
      rows.push([
        { v: a.label, s: 'text' },
        { v: a.date, s: 'text' },
        { v: libelleAbsence(a.kind), s: 'text' },
        { v: a.debut && a.fin ? `${a.debut}–${a.fin}` : `${Number(a.heures)} h`, s: 'text' },
        { v: a.commentaire ?? '', s: 'text' },
      ]);
    }
    rows.push([]);
    rows.push(['Récapitulatif par salarié', '', '', '', ''].map(entete));
    for (const s of parSalarie) {
      rows.push([
        { v: s.label, s: 'text' },
        { v: s.jours, s: 'qty' },
        { v: [...s.parMotif.entries()].map(([k, n]) => `${libelleAbsence(k)} ${n}`).join(', '), s: 'text' },
        null, null,
      ]);
    }
    downloadStyledXlsx(`absences_${mois}`, rows, {
      sheetName: 'Absences', cols: [28, 14, 22, 16, 40], merges: ['A1:E1', 'A2:E2'], freezeRows: 4,
    });
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <PalmtreeIcon size={20} /> Congés et absences
        </h1>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Bouton variante="secondaire" icone={Download} onClick={exporterExcel}>Excel</Bouton>
          <Bouton
            variante="secondaire"
            icone={FileText}
            onClick={() => apiDownload(
              `/personnel/absences/export.pdf?${requete}`, token, `absences-${mois}.pdf`,
            )}
          >
            PDF
          </Bouton>
          <Bouton
            icone={Plus}
            onClick={() => setFenetre({
              mode: 'creation',
              initial: { employeeId: salarie, debut: iso(new Date()), fin: iso(new Date()) },
            })}
          >
            Poser une absence
          </Bouton>
        </span>
      </div>
      <p className="muted" style={{ marginTop: 4, maxWidth: 820 }}>
        Congés, arrêts, intempéries, formation… Une absence ne coûte rien à un chantier : elle dit
        seulement que la personne n’est pas disponible — et le planning cesse ainsi de promettre
        quelqu’un qui ne viendra pas.
      </p>

      {err && <Alerte>{err}</Alerte>}

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button className="btn-ghost" title="Mois précédent" onClick={() => setMois(decalerMois(mois, -1))}>
            <ChevronLeft size={16} />
          </button>
          <strong style={{ minWidth: 150, textAlign: 'center', fontSize: 13, textTransform: 'capitalize' }}>
            {libelleMois(mois)}
          </strong>
          <button className="btn-ghost" title="Mois suivant" onClick={() => setMois(decalerMois(mois, 1))}>
            <ChevronRight size={16} />
          </button>
          <button className="btn-ghost" onClick={() => setMois(moisCourant())}>Aujourd’hui</button>
        </div>

        <div className="field" style={{ marginBottom: 0 }}>
          <label>Salarié</label>
          <select value={salarie} onChange={(e) => setSalarie(e.target.value)} style={{ minWidth: 180 }}>
            <option value="">Tous</option>
            {(salaries.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Motif</label>
          <select value={motif} onChange={(e) => setMotif(e.target.value)} style={{ minWidth: 170 }}>
            <option value="">Tous</option>
            {MOTIFS_ABSENCE.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
          </select>
        </div>

        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          <Bouton
            variante={vue === 'calendrier' ? 'primaire' : 'secondaire'}
            icone={CalendarDays}
            onClick={() => setVue('calendrier')}
          >
            Calendrier
          </Bouton>
          <Bouton
            variante={vue === 'liste' ? 'primaire' : 'secondaire'}
            icone={List}
            onClick={() => setVue('liste')}
          >
            Liste
          </Bouton>
        </div>
      </div>

      <div className="card-grid" style={{ marginTop: 14 }}>
        <CarteKpi titre="Jours d’absence" valeur={totalJours} detail={libelleMois(mois)} />
        <CarteKpi titre="Salariés concernés" valeur={parSalarie.length} />
        <CarteKpi
          titre="Motif principal"
          valeur={(() => {
            const cumul = new Map<string, number>();
            for (const s of parSalarie) {
              for (const [k, n] of s.parMotif) cumul.set(k, (cumul.get(k) ?? 0) + n);
            }
            const premier = [...cumul.entries()].sort((a, b) => b[1] - a[1])[0];
            return premier ? libelleAbsence(premier[0]) : '—';
          })()}
        />
        <CarteKpi titre="Absences saisies" valeur={lignes.length} detail="lignes sur la période affichée" />
      </div>

      <div style={{ marginTop: 14 }}>
        {vue === 'calendrier' ? (
          <CalendrierAbsences
            mois={mois}
            absences={lignes}
            onJour={(date) => setFenetre({
              mode: 'creation',
              initial: { employeeId: salarie, debut: date, fin: date },
            })}
            onAbsence={(a) => setFenetre({
              mode: 'edition',
              initial: {
                id: a.id, employeeId: a.employeeId, kind: a.kind, debut: a.date,
                debutHeure: a.debut, finHeure: a.fin, commentaire: a.commentaire,
              },
            })}
          />
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
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
                        <span style={{ width: 9, height: 9, borderRadius: 2, background: couleurAbsence(a.kind) }} />
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
        )}
      </div>

      {parSalarie.length > 0 && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
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

      {fenetre && (
        <AbsenceModal
          mode={fenetre.mode}
          initial={fenetre.initial}
          salaries={(salaries.data ?? []).map((s) => ({ id: s.id, label: s.fullName }))}
          onClose={() => setFenetre(null)}
          onSaved={() => {
            setFenetre(null);
            // Le planning et les conflits lisent les mêmes absences : ils doivent suivre.
            for (const key of ['absences', 'creneaux', 'creneaux-mois', 'occupation', 'conflits', 'conflits-mois']) {
              qc.invalidateQueries({ queryKey: [key] });
            }
          }}
        />
      )}
    </div>
  );
}
