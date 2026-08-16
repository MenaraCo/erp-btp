'use client';

import { useMemo } from 'react';
import { Lock } from 'lucide-react';

export interface PointageJour {
  id: string;
  employee_id: string | null;
  employee_label: string;
  work_date: string;
  hours: string;
  hourly_cost: string;
  cost: string;
  start_time: string | null;
  end_time: string | null;
  ouvrage_label: string | null;
  code_analytique: string | null;
  impute: boolean;
  releve_signe: boolean;
}

const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Un pointage figé ne se corrige plus : imputé au résultat, ou couvert par un relevé signé. */
export function estFige(p: PointageJour): boolean {
  return p.impute || p.releve_signe;
}

/**
 * Agenda des pointages — le mois ou la semaine, comme un planning.
 *
 * La saisie des heures se relisait dans une liste à plat, triée par date : pour vérifier une
 * semaine il fallait la reconstituer de tête. Posées sur un calendrier, les journées creuses et
 * les oublis se voient sans rien chercher.
 *
 * Chaque pastille porte le cadenas quand la ligne est figée — imputée au résultat du chantier, ou
 * couverte par un relevé de paye signé. Mieux vaut voir tout de suite pourquoi le crayon manque
 * que de découvrir le refus après avoir tout ressaisi.
 */
export function CalendrierPointages({
  vue, ancre, pointages, onJour, onPointage,
}: {
  vue: 'mois' | 'semaine';
  /** Jour d'ancrage (AAAA-MM-JJ) : le mois ou la semaine qui le contient est affiché. */
  ancre: string;
  pointages: PointageJour[];
  onJour?: (date: string) => void;
  onPointage?: (p: PointageJour) => void;
}) {
  const jours = useMemo(() => {
    const [a, m, j] = ancre.split('-').map(Number);
    const base = new Date(a, m - 1, j);
    if (vue === 'semaine') {
      const lundi = new Date(base);
      lundi.setDate(base.getDate() - ((base.getDay() + 6) % 7));
      return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(lundi);
        d.setDate(lundi.getDate() + i);
        return d;
      });
    }
    const premier = new Date(a, m - 1, 1);
    const debut = new Date(premier);
    debut.setDate(1 - ((premier.getDay() + 6) % 7));
    const total = 42;
    const grille = Array.from({ length: total }, (_, i) => {
      const d = new Date(debut);
      d.setDate(debut.getDate() + i);
      return d;
    });
    // On coupe la dernière semaine si elle est entièrement hors du mois : six lignes pour rien
    // font défiler l'écran sans rien montrer.
    const derniere = grille.slice(35);
    return derniere.every((d) => d.getMonth() !== m - 1) ? grille.slice(0, 35) : grille;
  }, [ancre, vue]);

  const parJour = useMemo(() => {
    const carte = new Map<string, PointageJour[]>();
    for (const p of pointages) {
      const liste = carte.get(p.work_date) ?? [];
      liste.push(p);
      carte.set(p.work_date, liste);
    }
    return carte;
  }, [pointages]);

  const moisAffiche = Number(ancre.split('-')[1]);
  const aujourdhui = iso(new Date());
  const maxPastilles = vue === 'semaine' ? 12 : 3;

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
        {JOURS.map((j) => (
          <div key={j} className="muted" style={{
            padding: '8px 10px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
            letterSpacing: '0.3px', borderBottom: '1px solid var(--border)',
          }}>
            {j}
          </div>
        ))}
        {jours.map((d) => {
          const cle = iso(d);
          const duMois = vue === 'semaine' || d.getMonth() === moisAffiche - 1;
          const weekend = d.getDay() === 0 || d.getDay() === 6;
          const lignes = parJour.get(cle) ?? [];
          const heures = lignes.reduce((s, p) => s + Number(p.hours), 0);
          return (
            <div
              key={cle}
              onClick={() => onJour?.(cle)}
              style={{
                minHeight: vue === 'semaine' ? 320 : 104, padding: 6,
                borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)',
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
                {heures > 0 && (
                  <span className="muted" style={{ fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>
                    {heures.toLocaleString('fr-FR')} h
                  </span>
                )}
              </div>
              {lignes.slice(0, maxPastilles).map((p) => (
                <button
                  key={p.id}
                  title={`${p.employee_label} — ${Number(p.hours)} h`
                    + `${p.ouvrage_label ? ` · ${p.ouvrage_label}` : ''}`
                    + `${estFige(p) ? ' · figé' : ''}`}
                  onClick={(e) => { e.stopPropagation(); onPointage?.(p); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4, width: '100%',
                    textAlign: 'left', cursor: 'pointer', border: 'none',
                    borderLeft: `3px solid ${estFige(p) ? '#94a3b8' : 'var(--primary)'}`,
                    background: estFige(p) ? 'rgba(148,163,184,.15)' : 'rgba(26,58,92,.10)',
                    color: 'var(--ink)', borderRadius: 3, padding: '2px 5px', marginBottom: 2,
                    fontSize: 10.5,
                  }}
                >
                  {estFige(p) && <Lock size={9} style={{ flexShrink: 0, opacity: 0.7 }} />}
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.employee_label}
                  </span>
                  <span style={{ fontVariantNumeric: 'tabular-nums', opacity: 0.75 }}>
                    {Number(p.hours)}
                  </span>
                </button>
              ))}
              {lignes.length > maxPastilles && (
                <div className="muted" style={{ fontSize: 10, paddingLeft: 5 }}>
                  + {lignes.length - maxPastilles} autre{lignes.length - maxPastilles > 1 ? 's' : ''}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
