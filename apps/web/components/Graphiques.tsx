'use client';

import React, { useId } from 'react';

/**
 * Graphiques du noyau de présentation — camembert, barres, courbe.
 *
 * Écrits à la main en SVG, sans bibliothèque : ce qu'on affiche ici tient en quelques formes, et
 * une dépendance de graphiques pèse plus lourd que tout le reste de l'application. Elle imposerait
 * aussi sa palette, alors que les deux couleurs de la société doivent gouverner l'écran.
 *
 * Trois règles tenues partout :
 * — un graphique ne remplace jamais le tableau, il le précède (le chiffre exact reste lisible) ;
 * — une part illisible (moins de 2 %) est regroupée dans « Autres » plutôt que dessinée en trait ;
 * — rien n'est inventé : une série vide affiche un message, pas un graphique plat qui suggère zéro.
 */

/** Palette : les deux couleurs de la société d'abord, puis des teintes sobres qui s'en distinguent. */
export const PALETTE = [
  'var(--primary)', 'var(--accent)', '#0f766e', '#b45309', '#6366f1',
  '#0369a1', '#15803d', '#a16207', '#be123c', '#475569',
];

export interface Part {
  label: string;
  valeur: number;
  /** Couleur imposée (celle d'un chantier, par exemple) ; sinon la palette décide. */
  couleur?: string;
}

function formateur(v: number, unite?: string): string {
  const n = v.toLocaleString('fr-FR', { maximumFractionDigits: v >= 100 ? 0 : 2 });
  return unite ? `${n} ${unite}` : n;
}

/* ─────────── camembert (anneau) ─────────── */

/**
 * Camembert en anneau : la répartition d'un total. Le trou du milieu porte le total — la question
 * « quelle part ? » vient presque toujours avec « sur combien ? ».
 */
export function Camembert({
  parts, total, titre, unite = '€', taille = 168, maxTranches = 6, legende = true,
}: {
  parts: Part[];
  /** Total affiché au centre ; à défaut, la somme des parts. */
  total?: string;
  titre?: string;
  unite?: string;
  taille?: number;
  maxTranches?: number;
  legende?: boolean;
}) {
  const positives = parts.filter((p) => p.valeur > 0).sort((a, b) => b.valeur - a.valeur);
  const somme = positives.reduce((s, p) => s + p.valeur, 0);
  if (somme <= 0) {
    return <p className="muted" style={{ fontSize: 12, margin: 0 }}>Rien à répartir sur ce périmètre.</p>;
  }

  // Au-delà de quelques tranches, le camembert devient un nuancier illisible : le reste se groupe.
  const gardees = positives.slice(0, maxTranches);
  const reste = positives.slice(maxTranches).reduce((s, p) => s + p.valeur, 0);
  const tranches: Part[] = reste > 0
    ? [...gardees, { label: 'Autres', valeur: reste, couleur: '#94a3b8' }]
    : gardees;

  const r = taille / 2;
  const epaisseur = taille * 0.22;
  const rayon = r - epaisseur / 2;
  const circonference = 2 * Math.PI * rayon;
  let parcouru = 0;

  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg
        width={taille}
        height={taille}
        viewBox={`0 0 ${taille} ${taille}`}
        role="img"
        aria-label={titre ?? 'Répartition'}
        style={{ flexShrink: 0 }}
      >
        <g transform={`rotate(-90 ${r} ${r})`}>
          {tranches.map((p, i) => {
            const part = p.valeur / somme;
            const longueur = part * circonference;
            const cercle = (
              <circle
                key={p.label}
                cx={r}
                cy={r}
                r={rayon}
                fill="none"
                stroke={p.couleur ?? PALETTE[i % PALETTE.length]}
                strokeWidth={epaisseur}
                strokeDasharray={`${longueur} ${circonference - longueur}`}
                strokeDashoffset={-parcouru}
              >
                <title>{`${p.label} — ${formateur(p.valeur, unite)} (${Math.round(part * 100)} %)`}</title>
              </circle>
            );
            parcouru += longueur;
            return cercle;
          })}
        </g>
        <text
          x={r} y={r - 2} textAnchor="middle"
          style={{ fontSize: 13, fontWeight: 700, fill: 'var(--ink)' }}
        >
          {total ?? formateur(somme, unite)}
        </text>
        {titre && (
          <text
            x={r} y={r + 12} textAnchor="middle"
            style={{ fontSize: 9, fill: 'var(--muted)', textTransform: 'uppercase' }}
          >
            {titre}
          </text>
        )}
      </svg>

      {legende && (
        <div style={{ display: 'grid', gap: 4, minWidth: 150, flex: 1 }}>
          {tranches.map((p, i) => (
            <div key={p.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
              <span style={{
                width: 9, height: 9, borderRadius: 2, flexShrink: 0,
                background: p.couleur ?? PALETTE[i % PALETTE.length],
              }} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.label}
              </span>
              <span className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {Math.round((p.valeur / somme) * 100)} %
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────── barres horizontales (classement) ─────────── */

/**
 * Classement : qui pèse le plus. En horizontal, parce que les libellés sont des noms de
 * fournisseurs ou de chantiers — illisibles s'ils sont couchés sous un axe vertical.
 */
export function BarresClassement({
  parts, unite = '€', maxLignes = 8, formatValeur,
}: {
  parts: Part[];
  unite?: string;
  maxLignes?: number;
  formatValeur?: (v: number) => string;
}) {
  const lignes = parts.filter((p) => p.valeur !== 0).sort((a, b) => b.valeur - a.valeur).slice(0, maxLignes);
  const max = Math.max(...lignes.map((p) => Math.abs(p.valeur)), 1);
  if (lignes.length === 0) {
    return <p className="muted" style={{ fontSize: 12, margin: 0 }}>Aucune valeur à comparer.</p>;
  }
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {lignes.map((p, i) => (
        <div key={p.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
          <span style={{
            width: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {p.label}
          </span>
          <span style={{ flex: 1, background: 'var(--surface)', borderRadius: 3, height: 12 }}>
            <span
              title={`${p.label} — ${formatValeur ? formatValeur(p.valeur) : formateur(p.valeur, unite)}`}
              style={{
                display: 'block', height: 12, borderRadius: 3,
                width: `${Math.max(1, (Math.abs(p.valeur) / max) * 100)}%`,
                background: p.couleur ?? PALETTE[i % PALETTE.length],
              }}
            />
          </span>
          <span style={{ width: 96, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            {formatValeur ? formatValeur(p.valeur) : formateur(p.valeur, unite)}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ─────────── barres groupées (comparaison de séries) ─────────── */

export interface SerieBarres {
  label: string;
  couleur: string;
}

/**
 * Barres groupées : les mêmes postes vus sous plusieurs mesures — budget, engagé, réalisé, ou
 * commandé, reçu, facturé. C'est la comparaison que le tableau rend possible mais pas évidente.
 */
export function BarresGroupees({
  categories, series, valeurs, unite = '€', hauteur = 190,
}: {
  categories: string[];
  series: SerieBarres[];
  /** valeurs[categorie][serie] */
  valeurs: number[][];
  unite?: string;
  hauteur?: number;
}) {
  const id = useId();
  const max = Math.max(...valeurs.flat().map((v) => Math.abs(v)), 1);
  if (categories.length === 0 || valeurs.flat().every((v) => v === 0)) {
    return <p className="muted" style={{ fontSize: 12, margin: 0 }}>Aucun montant sur ce périmètre.</p>;
  }

  // Sous quatre catégories, une barre étirée sur tout l'espace ne se compare plus à rien : on
  // garde la largeur d'un graphique de quatre postes et on centre ce qu'on a.
  const largeurCat = 100 / Math.max(categories.length, 4);
  const largeurBarre = largeurCat / (series.length + 1);
  const marge = (100 - largeurCat * categories.length) / 2;
  const hautGraphe = hauteur - 34; // place réservée aux libellés sous l'axe

  return (
    <div>
      <svg width="100%" height={hauteur} viewBox={`0 0 100 ${hauteur}`} preserveAspectRatio="none" role="img">
        {/* Trois repères horizontaux suffisent : au-delà, la grille mange le graphique. */}
        {[0, 0.5, 1].map((f) => (
          <line
            key={f} x1={0} x2={100} y1={hautGraphe - f * hautGraphe} y2={hautGraphe - f * hautGraphe}
            stroke="var(--border)" strokeWidth={0.5} vectorEffect="non-scaling-stroke"
          />
        ))}
        {categories.map((cat, ic) => (
          <g key={`${id}-${cat}`}>
            {series.map((s, is) => {
              const v = Math.abs(valeurs[ic]?.[is] ?? 0);
              const h = (v / max) * hautGraphe;
              return (
                <rect
                  key={s.label}
                  x={marge + ic * largeurCat + largeurBarre * (is + 0.5)}
                  y={hautGraphe - h}
                  width={largeurBarre * 0.9}
                  height={Math.max(h, v > 0 ? 1 : 0)}
                  fill={s.couleur}
                >
                  <title>{`${cat} · ${s.label} — ${formateur(valeurs[ic][is], unite)}`}</title>
                </rect>
              );
            })}
          </g>
        ))}
      </svg>
      {/* Les libellés sont posés en HTML : dans un SVG étiré, le texte se déforme. */}
      <div style={{ display: 'flex', marginTop: -28, marginLeft: `${marge}%` }}>
        {categories.map((cat) => (
          <div
            key={cat}
            className="muted"
            style={{
              width: `${largeurCat}%`, fontSize: 10, textAlign: 'center',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {cat}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
        {series.map((s) => (
          <span key={s.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: s.couleur }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ─────────── courbe (évolution) ─────────── */

export interface SerieCourbe {
  label: string;
  couleur: string;
  points: number[];
}

/** Évolution dans le temps : un cumul, une consommation mensuelle, une courbe de pilotage. */
export function Courbe({
  abscisses, series, unite = '€', hauteur = 190,
}: {
  abscisses: string[];
  series: SerieCourbe[];
  unite?: string;
  hauteur?: number;
}) {
  const max = Math.max(...series.flatMap((s) => s.points), 1);
  const hautGraphe = hauteur - 26;
  const pas = abscisses.length > 1 ? 100 / (abscisses.length - 1) : 100;
  if (abscisses.length === 0) {
    return <p className="muted" style={{ fontSize: 12, margin: 0 }}>Aucune période à afficher.</p>;
  }

  return (
    <div>
      <svg width="100%" height={hauteur} viewBox={`0 0 100 ${hauteur}`} preserveAspectRatio="none" role="img">
        {[0, 0.5, 1].map((f) => (
          <line
            key={f} x1={0} x2={100} y1={hautGraphe - f * hautGraphe} y2={hautGraphe - f * hautGraphe}
            stroke="var(--border)" strokeWidth={0.5} vectorEffect="non-scaling-stroke"
          />
        ))}
        {series.map((s) => (
          <polyline
            key={s.label}
            fill="none"
            stroke={s.couleur}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            points={s.points
              .map((v, i) => `${i * pas},${hautGraphe - (v / max) * hautGraphe}`)
              .join(' ')}
          >
            <title>{`${s.label} — dernier point ${formateur(s.points[s.points.length - 1] ?? 0, unite)}`}</title>
          </polyline>
        ))}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: -20 }}>
        {abscisses.map((a) => (
          <span key={a} className="muted" style={{ fontSize: 10 }}>{a}</span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
        {series.map((s) => (
          <span key={s.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
            <span style={{ width: 12, height: 3, borderRadius: 2, background: s.couleur }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
