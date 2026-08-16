'use client';

import React from 'react';
import Link from 'next/link';
import { Statut, Ton } from '@/lib/statuts';

/**
 * Noyau de présentation — les éléments visuels communs à TOUS les modules.
 *
 * Chaque écran habillait ses boutons, ses badges et ses écrans vides à sa façon : on changeait de
 * module et on changeait de vocabulaire visuel, alors que le geste était le même. Tout ce qui se
 * répète d'un module à l'autre est donc défini ici une fois, et se corrige ici une fois.
 *
 * Le style reste dans la feuille CSS (`globals.css`, thèmes compris) : ces composants n'inventent
 * pas de couleurs, ils choisissent une classe. C'est ce qui permet aux deux couleurs
 * paramétrables de la société de s'appliquer partout sans repasser dans le code.
 */

/* ─────────── boutons ─────────── */

export type VarianteBouton = 'primaire' | 'secondaire' | 'discret' | 'danger';

const CLASSE_BOUTON: Record<VarianteBouton, string> = {
  primaire: 'btn',
  secondaire: 'btn btn-secondary',
  discret: 'btn-ghost',
  danger: 'btn btn-danger',
};

type ProprietesBouton = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className'> & {
  variante?: VarianteBouton;
  /** Icône lucide, posée avant le libellé — même taille partout. */
  icone?: React.ElementType;
  /** Action en cours : le bouton se désactive et le dit, plutôt que de sembler inerte. */
  chargement?: boolean;
  libelleChargement?: string;
  className?: string;
};

export function Bouton({
  variante = 'primaire',
  icone: Icone,
  chargement = false,
  libelleChargement,
  children,
  disabled,
  className,
  ...reste
}: ProprietesBouton) {
  const classes = `${CLASSE_BOUTON[variante]}${className ? ` ${className}` : ''}`;
  return (
    <button className={classes} disabled={disabled || chargement} {...reste}>
      {Icone && <Icone size={14} />}
      {chargement ? (libelleChargement ?? children) : children}
    </button>
  );
}

/** Même apparence qu'un bouton, mais c'est un lien : la navigation reste une navigation. */
export function LienBouton({
  href, variante = 'secondaire', icone: Icone, children, className, title,
}: {
  href: string;
  variante?: VarianteBouton;
  icone?: React.ElementType;
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <Link
      href={href}
      title={title}
      className={`${CLASSE_BOUTON[variante]}${className ? ` ${className}` : ''}`}
    >
      {Icone && <Icone size={14} />}
      {children}
    </Link>
  );
}

/* ─────────── badges ─────────── */

const CLASSE_TON: Record<Ton, string> = {
  neutre: 'badge',
  succes: 'badge success',
  info: 'badge info',
  attention: 'badge warning',
  danger: 'badge danger',
};

export function Badge({ ton = 'neutre', children }: { ton?: Ton; children: React.ReactNode }) {
  return <span className={CLASSE_TON[ton]}>{children}</span>;
}

/** Badge d'un statut métier : le libellé et le ton viennent du registre, jamais de l'écran. */
export function BadgeStatut({ statut }: { statut: Statut }) {
  return <Badge ton={statut.ton}>{statut.label}</Badge>;
}

/* ─────────── cartes d'indicateur ─────────── */

export function CarteKpi({
  titre, valeur, detail, ton, icone: Icone,
}: {
  titre: string;
  valeur: React.ReactNode;
  detail?: React.ReactNode;
  /** Colore la VALEUR seulement : une carte entière en rouge crie sans rien dire de plus. */
  ton?: 'danger' | 'succes';
  icone?: React.ElementType;
}) {
  const couleur = ton === 'danger' ? 'var(--danger)' : ton === 'succes' ? 'var(--success)' : undefined;
  return (
    <div className="card">
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {Icone && <Icone size={13} />}{titre}
      </h2>
      <div className="stat" style={{ color: couleur }}>{valeur}</div>
      {detail != null && <div className="muted">{detail}</div>}
    </div>
  );
}

/* ─────────── écrans vides et messages ─────────── */

/**
 * Écran vide. Un tableau vide sans un mot laisse croire à une panne ; on dit donc ce qui manque
 * ET par quoi commencer.
 */
export function EtatVide({
  icone: Icone, titre, indice, action,
}: {
  icone?: React.ElementType;
  titre: string;
  indice?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div style={{ padding: '28px 20px', textAlign: 'center' }}>
      {Icone && (
        <div style={{ color: 'var(--muted)', opacity: 0.5, marginBottom: 8 }}>
          <Icone size={26} />
        </div>
      )}
      <div style={{ fontWeight: 600, fontSize: 13 }}>{titre}</div>
      {indice && (
        <div className="muted" style={{ fontSize: 12, marginTop: 4, maxWidth: 420, marginInline: 'auto' }}>
          {indice}
        </div>
      )}
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </div>
  );
}

/** Le même écran vide, mais à l'intérieur d'un tableau : il occupe toute la largeur. */
export function LigneVide({
  colonnes, titre, indice, icone,
}: {
  colonnes: number;
  titre: string;
  indice?: React.ReactNode;
  icone?: React.ElementType;
}) {
  return (
    <tr>
      <td colSpan={colonnes} style={{ padding: 0 }}>
        <EtatVide icone={icone} titre={titre} indice={indice} />
      </td>
    </tr>
  );
}

/**
 * Message d'alerte. La classe `.error` employée dans une soixantaine d'écrans partage le même
 * encadré : rien à réécrire pour que tout l'ancien profite de la correction.
 */
export function Alerte({
  ton = 'danger', children,
}: {
  ton?: 'danger' | 'info' | 'succes';
  children: React.ReactNode;
}) {
  return (
    <div className={ton === 'danger' ? 'alerte' : `alerte ${ton}`} role={ton === 'danger' ? 'alert' : undefined}>
      {children}
    </div>
  );
}
