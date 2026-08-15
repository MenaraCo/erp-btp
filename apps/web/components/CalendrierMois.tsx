'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { couleurAbsence, libelleAbsence } from '@/lib/absences';

export interface CreneauCalendrier {
  id: string;
  /** `absence` : congés, maladie, intempéries… — sans chantier, et sans coût. */
  kind: 'realise' | 'prevu' | 'absence';
  label: string;
  chantierId: string;
  chantierCode: string;
  chantierNom: string;
  /** Couleur choisie pour ce chantier ; à défaut, une teinte déduite de son identifiant. */
  chantierCouleur?: string | null;
  /** Motif, pour les seules absences. */
  motif?: string | null;
  commentaire?: string | null;
  date: string;
  heures: string;
  debut: string | null;
  fin: string | null;
  fige: boolean;
}

const TEINTES = ['#1a3a5c', '#e8550a', '#0f766e', '#7c3aed', '#b45309', '#be123c', '#0369a1'];

/**
 * Couleur d'un chantier : celle qu'on lui a choisie, sinon une teinte déduite de son identifiant.
 * Le repli garde les calendriers lisibles pour les chantiers créés avant ce réglage.
 */
export function teinteChantier(id: string, couleur?: string | null): string {
  if (couleur) return couleur;
  let n = 0;
  for (let i = 0; i < id.length; i += 1) n = (n + id.charCodeAt(i)) % TEINTES.length;
  return TEINTES[n];
}

/** Fond rayé : une absence se lit d'un coup d'œil comme « pas de production », pas comme un chantier. */
function rayures(couleur: string): string {
  return `repeating-linear-gradient(135deg, ${couleur}22, ${couleur}22 4px, ${couleur}0d 4px, ${couleur}0d 8px)`;
}

const EN_TETES = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
/** Au-delà, la case déborde : on annonce le reste plutôt que de tronquer en silence. */
const MAX_VISIBLE = 4;

export function iso(d: Date): string { return d.toISOString().slice(0, 10); }
export function lundiDe(d: Date): Date {
  const c = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const j = c.getUTCDay();
  c.setUTCDate(c.getUTCDate() - (j === 0 ? 6 : j - 1));
  return c;
}

/** Bornes de la grille d'un mois : semaines entières, un mois commençant rarement un lundi. */
export function grilleDuMois(ancre: string): { debut: string; fin: string; jours: string[]; mois: number } {
  const d = new Date(`${ancre}T00:00:00Z`);
  const premier = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const dernier = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  const depart = lundiDe(premier);
  const arrivee = lundiDe(dernier);
  arrivee.setUTCDate(arrivee.getUTCDate() + 6);
  const jours: string[] = [];
  for (const c = new Date(depart); c <= arrivee; c.setUTCDate(c.getUTCDate() + 1)) jours.push(iso(c));
  return { debut: iso(depart), fin: iso(arrivee), jours, mois: d.getUTCMonth() };
}

/**
 * Calendrier mensuel partagé — vue d'entreprise comme vue d'un chantier.
 *
 * UNE SEULE grille CSS porte les en-têtes et tous les jours : découper le mois en une grille par
 * semaine laissait les colonnes se décaler d'une ligne à l'autre. Les hauteurs de case sont
 * fixées pour la même raison — une semaine chargée ne doit pas déformer les autres.
 */
export function CalendrierMois({
  jours,
  mois,
  creneaux,
  conflitsParJour,
  onDeplacer,
  onDeposerChantier,
  onMenuJour,
  onMenuCreneau,
  hauteurCase = 112,
}: {
  jours: string[];
  mois: number;
  creneaux: CreneauCalendrier[];
  conflitsParJour?: Map<string, string[]>;
  onDeplacer?: (kind: string, id: string, date: string) => void;
  /** Dépôt d'un chantier venu de la légende : planifie une journée sur ce jour. */
  onDeposerChantier?: (chantierId: string, date: string) => void;
  /** Clic droit sur un jour : ajouter des heures, poser une absence. */
  onMenuJour?: (jour: string, position: { x: number; y: number }) => void;
  /** Clic droit sur une intervention : la modifier, la retirer. */
  onMenuCreneau?: (creneau: CreneauCalendrier, position: { x: number; y: number }) => void;
  hauteurCase?: number;
}) {
  const [survole, setSurvole] = useState<string | null>(null);
  const accepteDepot = Boolean(onDeplacer || onDeposerChantier);

  const parJour = useMemo(() => {
    const m = new Map<string, CreneauCalendrier[]>();
    for (const c of creneaux) m.set(c.date, [...(m.get(c.date) ?? []), c]);
    return m;
  }, [creneaux]);

  return (
    <div
      className="card"
      style={{
        marginTop: 16, padding: 0, overflow: 'hidden',
        display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
      }}
    >
      {EN_TETES.map((j) => (
        <div key={j} style={{
          padding: '8px 10px', fontSize: 11, fontWeight: 600, textAlign: 'center',
          color: 'var(--muted)', borderBottom: '1px solid var(--border)',
        }}>
          {j}
        </div>
      ))}

      {jours.map((jour, index) => {
        const d = new Date(`${jour}T00:00:00Z`);
        const dansLeMois = d.getUTCMonth() === mois;
        const weekEnd = d.getUTCDay() === 0 || d.getUTCDay() === 6;
        const interventions = parJour.get(jour) ?? [];
        const motifs = conflitsParJour?.get(jour) ?? [];
        return (
          <div
            key={jour}
            onDragOver={accepteDepot ? (e) => { e.preventDefault(); setSurvole(jour); } : undefined}
            onDragLeave={accepteDepot ? () => setSurvole(null) : undefined}
            onDrop={accepteDepot ? (e) => {
              e.preventDefault();
              setSurvole(null);
              const [kind, id] = e.dataTransfer.getData('text/plain').split(':');
              if (!kind || !id) return;
              // Deux sources de dépôt : une intervention qu'on déplace, ou un chantier de la
              // légende qu'on pose sur un jour pour l'y planifier.
              if (kind === 'chantier') onDeposerChantier?.(id, jour);
              else onDeplacer?.(kind, id, jour);
            } : undefined}
            onContextMenu={onMenuJour ? (e) => {
              e.preventDefault();
              onMenuJour(jour, { x: e.clientX, y: e.clientY });
            } : undefined}
            title={motifs.join('\n') || undefined}
            style={{
              height: hauteurCase, padding: 6, overflow: 'hidden',
              borderTop: '1px solid var(--border)',
              // Pas de bordure à gauche de la première colonne : le cadre de la carte la porte déjà.
              borderLeft: index % 7 === 0 ? undefined : '1px solid var(--border)',
              background: survole === jour ? 'var(--surface-2, #eef2f7)'
                : motifs.length > 0 ? '#fef2f2'
                  : !dansLeMois ? 'var(--surface)'
                    : weekEnd ? 'var(--surface)' : undefined,
              opacity: dansLeMois ? 1 : 0.55,
            }}
          >
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              fontSize: 11, marginBottom: 4, lineHeight: 1.2,
            }}>
              <span style={{ fontWeight: dansLeMois ? 600 : 400 }}>{Number(jour.slice(8))}</span>
              {motifs.length > 0 && <AlertTriangle size={12} color="var(--danger, #dc2626)" />}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {interventions.slice(0, MAX_VISIBLE).map((c) => {
                const absence = c.kind === 'absence';
                const teinte = absence
                  ? couleurAbsence(c.motif ?? '')
                  : teinteChantier(c.chantierId, c.chantierCouleur);
                const plein = c.kind === 'realise';
                return (
                  <div
                    key={c.id}
                    draggable={Boolean(onDeplacer) && !c.fige && !absence}
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', `${c.kind}:${c.id}`)}
                    onContextMenu={onMenuCreneau ? (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onMenuCreneau(c, { x: e.clientX, y: e.clientY });
                    } : undefined}
                    title={`${c.label} · ${absence ? libelleAbsence(c.motif ?? '') : `${c.chantierCode} — ${c.chantierNom}`}\n${
                      c.debut ? `${c.debut}–${c.fin}` : `${Number(c.heures)} h`
                    }${c.kind === 'prevu' ? ' (prévu)' : ''}${c.fige ? '\nArrêté : non déplaçable' : ''}${
                      c.commentaire ? `\n${c.commentaire}` : ''}`}
                    style={{
                      background: plein ? teinte : absence ? rayures(teinte) : 'transparent',
                      border: `1px ${c.kind === 'prevu' ? 'dashed' : 'solid'} ${teinte}`,
                      color: plein ? '#fff' : teinte,
                      borderRadius: 4, fontSize: 10, lineHeight: 1.5, padding: '0 5px',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      fontWeight: absence ? 600 : 400,
                      cursor: !onDeplacer ? 'default' : c.fige || absence ? 'default' : 'grab',
                      opacity: c.fige ? 0.55 : 1,
                    }}
                  >
                    {absence
                      ? `${libelleAbsence(c.motif ?? '')} · ${c.label}`
                      : `${c.debut ? `${c.debut} ` : ''}${c.chantierCode} · ${c.label}`}
                  </div>
                );
              })}
              {interventions.length > MAX_VISIBLE && (
                <div className="muted" style={{ fontSize: 10, lineHeight: 1.5 }}>
                  + {interventions.length - MAX_VISIBLE} autre
                  {interventions.length - MAX_VISIBLE > 1 ? 's' : ''}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
