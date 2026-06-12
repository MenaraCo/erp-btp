'use client';

import { createContext, useContext, useEffect, useState } from 'react';

export type AppTheme = 'liquid-glass' | 'classic';

interface ThemeContextValue {
  theme: AppTheme;
  setTheme: (t: AppTheme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'liquid-glass',
  setTheme: () => {},
});

const STORAGE_KEY = 'erp-theme';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<AppTheme>('liquid-glass');

  // Lit la préférence sauvegardée au premier montage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as AppTheme | null;
      if (saved === 'classic' || saved === 'liquid-glass') {
        setThemeState(saved);
      }
    } catch {}
  }, []);

  // Applique/retire la classe sur <body> et persiste dans localStorage
  useEffect(() => {
    document.body.classList.toggle('theme-lg', theme === 'liquid-glass');
    try { localStorage.setItem(STORAGE_KEY, theme); } catch {}
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme: setThemeState }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
