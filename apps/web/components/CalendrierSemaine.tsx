'use client';

import { useState } from 'react';
import { CreneauCalendrier, teinteChantier } from './CalendrierMois';
import { couleurAbsence, libelleAbsence } from '@/lib/absences';

const JOURS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
/** Amplitude affichée : au-delà, la grille s'étire pour rien. */
const HEURE_DEBUT = 6;
const HEURE_FIN = 20;
const HAUTEUR_HEURE = 34;

function minutes(h: string): number {
  return Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
}

/**
 * Planning hebdomadaire — vue par tranches horaires, partagée par la Gestion du personnel et le
 * calendrier d'un chantier. Les deux écrans montrent la même chose sous deux filtres : il serait
 * absurde qu'ils ne se ressemblent pas.
 *
 * Les heures sans horaire précis restent affichées en haut de colonne (bandeau « journée ») :
 * beaucoup d'entreprises pointent en volume, et les exclure de la vue les rendrait invisibles.
 * Les créneaux horodatés se placent à leur place réelle, ce qui montre les chevauchements à l'œil.
 */
export function CalendrierSemaine({
  jours,
  creneaux,
  onDeplacer,
  onDeposerChantier,
  onMenuJour,
  onMenuCreneau,
}: {
  jours: string[];
  creneaux: CreneauCalendrier[];
  onDeplacer?: (kind: string, id: string, date: string) => void;
  onDeposerChantier?: (chantierId: string, date: string) => void;
  onMenuJour?: (jour: string, position: { x: number; y: number }) => void;
  onMenuCreneau?: (creneau: CreneauCalendrier, position: { x: number; y: number }) => void;
}) {
  const [survole, setSurvole] = useState<string | null>(null);
  const heures = Array.from({ length: HEURE_FIN - HEURE_DEBUT }, (_, i) => HEURE_DEBUT + i);

  const deposer = (charge: string, jour: string) => {
    const [kind, id] = charge.split(':');
    if (!kind || !id) return;
    if (kind === 'chantier') onDeposerChantier?.(id, jour);
    else onDeplacer?.(kind, id, jour);
  };

  const bloc = (c: CreneauCalendrier, style: React.CSSProperties) => {
    const absence = c.kind === 'absence';
    const teinte = absence ? couleurAbsence(c.motif ?? '') : teinteChantier(c.chantierId, c.chantierCouleur);
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
          c.ouvrage ? `\nOuvrage : ${c.ouvrage}` : ''}${
          c.codeAnalytique ? `\nCode analytique : ${c.codeAnalytique}` : ''}${
          c.commentaire ? `\n${c.commentaire}` : ''}`}
        style={{
          background: plein ? teinte
            : absence
              ? `repeating-linear-gradient(135deg, ${teinte}22, ${teinte}22 4px, ${teinte}0d 4px, ${teinte}0d 8px)`
              : 'transparent',
          border: `1px ${c.kind === 'prevu' ? 'dashed' : 'solid'} ${teinte}`,
          color: plein ? '#fff' : teinte,
          borderRadius: 4, fontSize: 10, padding: '1px 4px', overflow: 'hidden',
          cursor: !onDeplacer || c.fige || absence ? 'default' : 'grab',
          opacity: c.fige ? 0.55 : 1,
          ...style,
        }}
      >
        <div style={{ fontWeight: 600, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
          {absence ? libelleAbsence(c.motif ?? '') : c.chantierCode}
        </div>
        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden' }}>{c.label}</div>
      </div>
    );
  };

  const colonne = (jour: string, contenu: React.ReactNode, style: React.CSSProperties) => (
    <div
      key={`col-${jour}`}
      onDragOver={(e) => { e.preventDefault(); setSurvole(jour); }}
      onDragLeave={() => setSurvole(null)}
      onDrop={(e) => {
        e.preventDefault();
        setSurvole(null);
        deposer(e.dataTransfer.getData('text/plain'), jour);
      }}
      onContextMenu={onMenuJour ? (e) => {
        e.preventDefault();
        onMenuJour(jour, { x: e.clientX, y: e.clientY });
      } : undefined}
      style={{ background: survole === jour ? 'var(--surface)' : undefined, ...style }}
    >
      {contenu}
    </div>
  );

  return (
    <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'auto', flex: 1, minWidth: 0 }}>
      <div style={{ display: 'grid', gridTemplateColumns: `56px repeat(${jours.length}, minmax(110px, 1fr))` }}>
        <div style={{ borderBottom: '1px solid var(--border)' }} />
        {jours.map((j) => (
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
        {jours.map((j) => colonne(
          j,
          creneaux.filter((c) => c.date === j && !c.debut).map((c) => bloc(c, { position: 'relative' })),
          {
            borderLeft: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
            padding: 3, minHeight: 30, display: 'flex', flexDirection: 'column', gap: 2,
          },
        ))}

        {/* Grille horaire */}
        <div>
          {heures.map((h) => (
            <div key={h} style={{ height: HAUTEUR_HEURE, fontSize: 10, color: 'var(--muted)', padding: '2px 6px' }}>
              {String(h).padStart(2, '0')}:00
            </div>
          ))}
        </div>
        {jours.map((j) => colonne(
          j,
          <>
            {heures.map((h) => (
              <div key={h} style={{
                position: 'absolute', top: (h - HEURE_DEBUT) * HAUTEUR_HEURE, left: 0, right: 0,
                borderTop: '1px solid var(--border)', opacity: 0.5,
              }} />
            ))}
            {creneaux.filter((c) => c.date === j && c.debut && c.fin).map((c) => {
              const haut = ((minutes(c.debut!) - HEURE_DEBUT * 60) / 60) * HAUTEUR_HEURE;
              const hauteur = ((minutes(c.fin!) - minutes(c.debut!)) / 60) * HAUTEUR_HEURE;
              return bloc(c, {
                position: 'absolute', top: Math.max(0, haut), height: Math.max(16, hauteur),
                left: 2, right: 2,
              });
            })}
          </>,
          {
            position: 'relative', borderLeft: '1px solid var(--border)',
            height: heures.length * HAUTEUR_HEURE,
          },
        ))}
      </div>
    </div>
  );
}
