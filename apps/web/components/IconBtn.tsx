'use client';

import React from 'react';

/** Bouton icône fantôme — utilisé dans les tableaux pour les actions (éditer, supprimer…) */
export function IconBtn({
  title,
  onClick,
  color = 'var(--muted)',
  children,
  disabled,
}: {
  title: string;
  onClick: (e: React.MouseEvent) => void;
  color?: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        background: 'none',
        border: 'none',
        borderRadius: 4,
        padding: 4,
        cursor: disabled ? 'not-allowed' : 'pointer',
        color,
        opacity: disabled ? 0.4 : 0.8,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'opacity 0.12s, background 0.12s',
      }}
      onMouseEnter={(e) => {
        if (!disabled) (e.currentTarget as HTMLButtonElement).style.opacity = '1';
      }}
      onMouseLeave={(e) => {
        if (!disabled) (e.currentTarget as HTMLButtonElement).style.opacity = '0.8';
      }}
    >
      {children}
    </button>
  );
}
