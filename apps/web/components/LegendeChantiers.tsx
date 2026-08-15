'use client';

import { useState } from 'react';
import { GripVertical } from 'lucide-react';
import { teinteChantier } from './CalendrierMois';

export interface ChantierLegende {
  id: string;
  code: string;
  name: string;
  color?: string | null;
}

/** Palette proposée au choix : franche, et distinguable même pour un daltonien. */
const PALETTE = [
  '#1a3a5c', '#e8550a', '#0f766e', '#7c3aed',
  '#b45309', '#0369a1', '#4d7c0f', '#9d174d',
];

/**
 * Légende des chantiers, à côté du calendrier.
 *
 * Elle sert deux fois : elle dit quelle couleur appartient à quel chantier — sans quoi un
 * calendrier coloré n'est qu'un patchwork — et elle sert de RÉSERVE à glisser : on attrape un
 * chantier et on le dépose sur un jour pour y planifier une journée, sans passer par un
 * formulaire.
 */
export function LegendeChantiers({
  chantiers,
  actif,
  onChoisirCouleur,
  glissable = false,
  aide,
}: {
  chantiers: ChantierLegende[];
  /** Chantiers réellement présents sur la période : les autres sont estompés. */
  actif?: Set<string>;
  onChoisirCouleur?: (chantierId: string, color: string) => void;
  glissable?: boolean;
  aide?: string;
}) {
  const [ouvert, setOuvert] = useState<string | null>(null);

  return (
    // Largeur fixe : sans elle, un nom de chantier long étire la légende et écrase le calendrier.
    <div className="card" style={{ marginTop: 16, padding: 12, flex: '0 0 224px', width: 224 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 8 }}>
        CHANTIERS
      </div>
      {aide && (
        <p className="muted" style={{ fontSize: 11, marginTop: 0, marginBottom: 10, lineHeight: 1.45 }}>
          {aide}
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {chantiers.map((c) => {
          const couleur = teinteChantier(c.id, c.color);
          const present = !actif || actif.has(c.id);
          return (
            <div key={c.id}>
              <div
                draggable={glissable}
                onDragStart={(e) => e.dataTransfer.setData('text/plain', `chantier:${c.id}`)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, fontSize: 11,
                  padding: '3px 4px', borderRadius: 4,
                  cursor: glissable ? 'grab' : 'default',
                  opacity: present ? 1 : 0.45,
                }}
                title={`${c.code} — ${c.name}${glissable ? '\nÀ glisser sur un jour du calendrier' : ''}`}
              >
                {glissable && <GripVertical size={11} color="var(--muted)" />}
                <button
                  type="button"
                  onClick={() => onChoisirCouleur && setOuvert(ouvert === c.id ? null : c.id)}
                  title={onChoisirCouleur ? 'Changer la couleur' : undefined}
                  style={{
                    width: 13, height: 13, borderRadius: 3, flexShrink: 0,
                    background: couleur, border: '1px solid rgba(0,0,0,.15)', padding: 0,
                    cursor: onChoisirCouleur ? 'pointer' : 'default',
                  }}
                />
                <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{c.code}</span>
                <span className="muted" style={{
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0,
                }}>
                  {c.name}
                </span>
              </div>

              {ouvert === c.id && onChoisirCouleur && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '4px 0 6px 22px' }}>
                  {PALETTE.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => { onChoisirCouleur(c.id, p); setOuvert(null); }}
                      title={p}
                      style={{
                        width: 16, height: 16, borderRadius: 3, background: p, padding: 0,
                        border: p === couleur ? '2px solid var(--primary)' : '1px solid rgba(0,0,0,.15)',
                        cursor: 'pointer',
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {chantiers.length === 0 && (
          <span className="muted" style={{ fontSize: 11 }}>Aucun chantier.</span>
        )}
      </div>
    </div>
  );
}
