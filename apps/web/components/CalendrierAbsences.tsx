'use client';

import { useMemo } from 'react';
import { couleurAbsence, libelleAbsence } from '@/lib/absences';

export interface AbsenceCalendrier {
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

const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Calendrier mensuel des absences — la vue « agenda » que tout le monde connaît.
 *
 * Une liste de dates répond à « qui, quand », mais pas à la question qu'on se pose vraiment devant
 * un planning : QUELLE SEMAINE est dégarnie. Un mois posé à plat le montre d'un coup d'œil, et
 * chaque absence garde la couleur de son motif — les mêmes que dans les autres écrans.
 *
 * La grille commence toujours au lundi et couvre des semaines entières : sans les jours des mois
 * voisins, une absence du 31 au 2 se couperait en deux et paraîtrait plus courte qu'elle n'est.
 */
export function CalendrierAbsences({
  mois, absences, onJour, onAbsence,
}: {
  /** Mois affiché, au format AAAA-MM. */
  mois: string;
  absences: AbsenceCalendrier[];
  /** Clic sur une case : poser une absence ce jour-là. */
  onJour?: (date: string) => void;
  /** Clic sur une pastille : ouvrir l'absence. */
  onAbsence?: (a: AbsenceCalendrier) => void;
}) {
  const [annee, moisNum] = mois.split('-').map(Number);

  const semaines = useMemo(() => {
    const premier = new Date(annee, moisNum - 1, 1);
    // getDay() renvoie 0 pour dimanche : on décale pour que la semaine commence le lundi.
    const decalage = (premier.getDay() + 6) % 7;
    const debut = new Date(annee, moisNum - 1, 1 - decalage);
    const grille: Date[][] = [];
    const curseur = new Date(debut);
    while (grille.length < 6) {
      const semaine: Date[] = [];
      for (let i = 0; i < 7; i += 1) {
        semaine.push(new Date(curseur));
        curseur.setDate(curseur.getDate() + 1);
      }
      grille.push(semaine);
      // Six lignes seulement si le mois déborde vraiment : sinon la dernière serait vide.
      if (curseur.getMonth() !== moisNum - 1 && grille.length >= 5) break;
    }
    return grille;
  }, [annee, moisNum]);

  const parJour = useMemo(() => {
    const m = new Map<string, AbsenceCalendrier[]>();
    for (const a of absences) {
      const liste = m.get(a.date) ?? [];
      liste.push(a);
      m.set(a.date, liste);
    }
    return m;
  }, [absences]);

  const aujourdhui = iso(new Date());

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
        {JOURS.map((j) => (
          <div
            key={j}
            className="muted"
            style={{
              padding: '8px 10px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
              letterSpacing: '0.3px', borderBottom: '1px solid var(--border)',
            }}
          >
            {j}
          </div>
        ))}
        {semaines.flat().map((d) => {
          const cle = iso(d);
          const duMois = d.getMonth() === moisNum - 1;
          const weekend = d.getDay() === 0 || d.getDay() === 6;
          const jour = parJour.get(cle) ?? [];
          return (
            <div
              key={cle}
              onClick={() => onJour?.(cle)}
              style={{
                minHeight: 96, padding: 6, borderBottom: '1px solid var(--border)',
                borderRight: '1px solid var(--border)',
                background: weekend ? 'var(--surface)' : 'transparent',
                opacity: duMois ? 1 : 0.45,
                cursor: onJour ? 'pointer' : 'default',
              }}
            >
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                fontSize: 11, marginBottom: 4,
              }}>
                <span style={{
                  fontWeight: cle === aujourdhui ? 700 : 500,
                  color: cle === aujourdhui ? 'var(--accent)' : 'var(--ink)',
                }}>
                  {d.getDate()}
                </span>
                {jour.length > 2 && (
                  <span className="muted" style={{ fontSize: 10 }}>{jour.length}</span>
                )}
              </div>
              {jour.slice(0, 3).map((a) => (
                <button
                  key={a.id}
                  title={`${a.label} — ${libelleAbsence(a.kind)}${a.commentaire ? ` · ${a.commentaire}` : ''}`}
                  onClick={(e) => { e.stopPropagation(); onAbsence?.(a); }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
                    border: 'none', borderLeft: `3px solid ${couleurAbsence(a.kind)}`,
                    background: `${couleurAbsence(a.kind)}18`,
                    color: 'var(--ink)', borderRadius: 3, padding: '2px 5px', marginBottom: 2,
                    fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}
                >
                  {a.label}
                  {/* La demi-journée se lit sur la pastille : c'est ce que la paye décompte. */}
                  {a.debut && a.fin ? ` ${a.debut}` : ''}
                </button>
              ))}
              {jour.length > 3 && (
                <div className="muted" style={{ fontSize: 10, paddingLeft: 5 }}>
                  + {jour.length - 3} autre{jour.length - 3 > 1 ? 's' : ''}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
