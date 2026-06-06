'use client';

/**
 * Contexte global des préférences société.
 * Chargées une seule fois au niveau du layout authentifié, disponibles dans toute l'app.
 * Consommé via usePreferences().
 */
import { createContext, useContext, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './api';
import { useAuth } from './auth';

export interface Preferences {
  id: string;
  taux_fg_default: string;
  taux_ben_default: string;
  devis_prefix: string;
  devis_separator: string;
  couleur_principale: string;
  couleur_accent: string;
  taux_tva: number[];
  default_tab: 'etude' | 'coefficients' | 'client' | 'pdf';
  nb_decimales: 2 | 3 | 4;
}

export const DEFAULT_PREFS: Preferences = {
  id: '',
  taux_fg_default: '25',
  taux_ben_default: '15',
  devis_prefix: 'DEV',
  devis_separator: '-',
  couleur_principale: '#1a3a5c',
  couleur_accent: '#e8550a',
  taux_tva: [0, 5.5, 10, 20],
  default_tab: 'etude',
  nb_decimales: 2,
};

const PrefsContext = createContext<Preferences>(DEFAULT_PREFS);

export function PrefsProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();

  const { data: prefs } = useQuery<Preferences>({
    queryKey: ['app-preferences'],
    queryFn: () => apiFetch<Preferences>('/params/preferences', { token }),
    enabled: Boolean(token),
    staleTime: 5 * 60 * 1000, // 5 min — préfs changent rarement
  });

  const resolved = useMemo<Preferences>(() => {
    if (!prefs) return DEFAULT_PREFS;
    return {
      ...DEFAULT_PREFS,
      ...prefs,
      taux_tva: Array.isArray(prefs.taux_tva) ? prefs.taux_tva : DEFAULT_PREFS.taux_tva,
      nb_decimales: ([2, 3, 4].includes(Number(prefs.nb_decimales)) ? Number(prefs.nb_decimales) : 2) as 2 | 3 | 4,
    };
  }, [prefs]);

  // Applique les couleurs en CSS variables dynamiquement
  useEffect(() => {
    if (resolved.couleur_principale) {
      document.documentElement.style.setProperty('--primary', resolved.couleur_principale);
    }
    if (resolved.couleur_accent) {
      document.documentElement.style.setProperty('--accent', resolved.couleur_accent);
    }
  }, [resolved.couleur_principale, resolved.couleur_accent]);

  return <PrefsContext.Provider value={resolved}>{children}</PrefsContext.Provider>;
}

export function usePreferences(): Preferences {
  return useContext(PrefsContext);
}

/** Formate un montant selon le nb de décimales des préférences */
export function fmtEuro(amount: number | string | null | undefined, nbDec: number = 2): string {
  const n = Number(amount);
  if (isNaN(n) || amount === null || amount === undefined) return '—';
  return n.toLocaleString('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: nbDec,
    maximumFractionDigits: nbDec,
  });
}

/** Formate un nombre (sans symbole €) selon le nb de décimales */
export function fmtNum(n: number | string | null | undefined, nbDec: number = 2): string {
  const v = Number(n);
  if (isNaN(v) || n === null || n === undefined) return '—';
  return v.toLocaleString('fr-FR', {
    minimumFractionDigits: nbDec,
    maximumFractionDigits: nbDec,
  });
}
