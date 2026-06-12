'use client';
import React, { createContext, useCallback, useContext, useState } from 'react';

interface WorkspaceCtxType {
  splitOpen: boolean;
  panel2DevisId: string | null;
  panel2AffaireId: string | null;
  panel2Mode: 'normal' | 'minimized' | 'maximized';
  splitDirection: 'vertical' | 'horizontal';
  splitRatio: number;
  openSplit(): void;
  selectPanel2(devisId: string | null, affaireId: string | null): void;
  closePanel2(): void;
  toggleMinimize(): void;
  toggleMaximize(): void;
  toggleDirection(): void;
  setSplitRatio(r: number): void;
}

const WorkspaceCtx = createContext<WorkspaceCtxType | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [splitOpen, setSplitOpen] = useState(false);
  const [panel2DevisId, setPanel2DevisId] = useState<string | null>(null);
  const [panel2AffaireId, setPanel2AffaireId] = useState<string | null>(null);
  const [panel2Mode, setPanel2Mode] = useState<'normal' | 'minimized' | 'maximized'>('normal');
  const [splitDirection, setSplitDirection] = useState<'vertical' | 'horizontal'>('vertical');
  const [splitRatio, setSplitRatioRaw] = useState(0.5);

  const openSplit = useCallback(() => {
    setSplitOpen(true);
    setPanel2Mode('normal');
  }, []);

  const selectPanel2 = useCallback((devisId: string | null, affaireId: string | null) => {
    setPanel2DevisId(devisId);
    setPanel2AffaireId(affaireId);
  }, []);

  const closePanel2 = useCallback(() => {
    setSplitOpen(false);
    setPanel2DevisId(null);
    setPanel2AffaireId(null);
    setPanel2Mode('normal');
  }, []);

  const toggleMinimize = useCallback(() =>
    setPanel2Mode(m => m === 'minimized' ? 'normal' : 'minimized'), []);

  const toggleMaximize = useCallback(() =>
    setPanel2Mode(m => m === 'maximized' ? 'normal' : 'maximized'), []);

  const toggleDirection = useCallback(() =>
    setSplitDirection(d => d === 'vertical' ? 'horizontal' : 'vertical'), []);

  const setSplitRatio = useCallback((r: number) =>
    setSplitRatioRaw(Math.min(0.8, Math.max(0.2, r))), []);

  return (
    <WorkspaceCtx.Provider value={{
      splitOpen, panel2DevisId, panel2AffaireId, panel2Mode, splitDirection, splitRatio,
      openSplit, selectPanel2, closePanel2,
      toggleMinimize, toggleMaximize, toggleDirection, setSplitRatio,
    }}>
      {children}
    </WorkspaceCtx.Provider>
  );
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceCtx);
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return ctx;
}
