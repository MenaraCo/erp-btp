'use client';

import { useState } from 'react';
import { teinteChantier } from './CalendrierMois';

export interface ChantierLegende {
  id: string;
  code: string;
  name: string;
  color?: string | null;
}

/**
 * Palette proposée au choix — teintes franches, distinguables côte à côte dans un calendrier.
 * Le rouge vif reste réservé aux alertes de gestion : une couleur de chantier ne doit pas crier.
 */
const PALETTE = [
  '#1a3a5c', '#0369a1', '#0891b2', '#0f766e',
  '#15803d', '#4d7c0f', '#a16207', '#b45309',
  '#e8550a', '#c2410c', '#9d174d', '#be185d',
  '#7c3aed', '#4f46e5', '#57534e', '#334155',
];

/**
 * Légende des chantiers, à côté du calendrier.
 *
 * Elle sert deux fois : elle dit quelle couleur appartient à quel chantier — sans quoi un
 * calendrier coloré n'est qu'un patchwork — et elle sert de RÉSERVE à glisser : on attrape un
 * chantier et on le dépose sur un jour pour y planifier une journée, sans passer par un
 * formulaire.
 *
 * Chaque entrée tient sur deux lignes (code, puis nom en gris) : sur une seule, les deux se
 * disputaient la largeur et les codes finissaient coupés au milieu d'un mot.
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
  const [survole, setSurvole] = useState<string | null>(null);

  return (
    // Largeur fixe : sans elle, un nom de chantier long étire la légende et écrase le calendrier.
    <aside className="card" style={{ marginTop: 16, padding: '12px 10px', flex: '0 0 248px', width: 248 }}>
      <div style={{
        fontSize: 11, fontWeight: 600, letterSpacing: '.04em', color: 'var(--muted)',
        padding: '0 6px 8px',
      }}>
        CHANTIERS
      </div>
      {aide && (
        <p className="muted" style={{
          fontSize: 11, lineHeight: 1.5, margin: '0 6px 10px',
          paddingBottom: 10, borderBottom: '1px solid var(--border)',
        }}>
          {aide}
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {chantiers.map((c) => {
          const couleur = teinteChantier(c.id, c.color);
          const present = !actif || actif.has(c.id);
          return (
            <div key={c.id}>
              <div
                draggable={glissable}
                onDragStart={(e) => e.dataTransfer.setData('text/plain', `chantier:${c.id}`)}
                onMouseEnter={() => setSurvole(c.id)}
                onMouseLeave={() => setSurvole(null)}
                title={glissable ? `${c.code} — ${c.name}\nÀ glisser sur un jour du calendrier` : `${c.code} — ${c.name}`}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8,
                  padding: '6px', borderRadius: 6,
                  cursor: glissable ? 'grab' : 'default',
                  background: survole === c.id ? 'var(--surface)' : undefined,
                  opacity: present ? 1 : 0.5,
                }}
              >
                <button
                  type="button"
                  onClick={() => onChoisirCouleur && setOuvert(ouvert === c.id ? null : c.id)}
                  title={onChoisirCouleur ? 'Changer la couleur' : undefined}
                  aria-label={onChoisirCouleur ? `Couleur de ${c.code}` : undefined}
                  style={{
                    width: 12, height: 12, borderRadius: 3, flexShrink: 0, marginTop: 2,
                    background: couleur, border: 'none', padding: 0,
                    boxShadow: ouvert === c.id ? '0 0 0 2px var(--surface), 0 0 0 3px var(--primary)' : undefined,
                    cursor: onChoisirCouleur ? 'pointer' : 'default',
                  }}
                />
                <div style={{ minWidth: 0, lineHeight: 1.35 }}>
                  <div style={{
                    fontSize: 11.5, fontWeight: 600,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {c.code}
                  </div>
                  <div className="muted" style={{
                    fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {c.name}
                  </div>
                </div>
              </div>

              {ouvert === c.id && onChoisirCouleur && (
                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 4,
                  padding: '4px 6px 10px 26px',
                }}>
                  {PALETTE.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => { onChoisirCouleur(c.id, p); setOuvert(null); }}
                      title={p}
                      aria-label={`Couleur ${p}`}
                      style={{
                        width: 16, height: 16, borderRadius: 3, background: p, padding: 0,
                        border: 'none', cursor: 'pointer',
                        boxShadow: p === couleur
                          ? '0 0 0 2px var(--surface), 0 0 0 3px var(--primary)'
                          : undefined,
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {chantiers.length === 0 && (
          <span className="muted" style={{ fontSize: 11, padding: 6 }}>Aucun chantier.</span>
        )}
      </div>
    </aside>
  );
}
