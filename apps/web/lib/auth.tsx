'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './api';

interface AuthState {
  token: string | null;
  email: string | null;
  tenantSlug: string | null;
}

interface AuthContextValue extends AuthState {
  isAuthenticated: boolean;
  /** Renvoie `{ mfaRequired: true }` si le mot de passe est bon mais qu'un code 2FA est attendu. */
  login: (
    tenantSlug: string,
    email: string,
    password: string,
    totp?: string,
  ) => Promise<{ mfaRequired: boolean }>;
  /** Establishes a session from an already-issued token (e.g. right after sign-up). */
  setSession: (token: string, email: string, tenantSlug: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * In-memory auth (no sensitive data in browser storage, per the cahier des charges).
 * A page reload requires logging in again — acceptable for this skeleton; a refresh-token
 * flow / httpOnly cookie would replace it later.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({
    token: null,
    email: null,
    tenantSlug: null,
  });

  const login = useCallback(
    async (tenantSlug: string, email: string, password: string, totp?: string) => {
      const res = await apiFetch<{ accessToken?: string; mfaRequired?: boolean }>('/auth/login', {
        method: 'POST',
        tenantSlug,
        body: { email, password, ...(totp ? { totp } : {}) },
      });
      if (res.mfaRequired) return { mfaRequired: true };
      setState({ token: res.accessToken as string, email, tenantSlug });
      return { mfaRequired: false };
    },
    [],
  );

  const setSession = useCallback(
    (token: string, email: string, tenantSlug: string) => {
      setState({ token, email, tenantSlug });
    },
    [],
  );

  const logout = useCallback(() => {
    setState({ token: null, email: null, tenantSlug: null });
    // Le cache des requêtes appartient à la personne connectée : ses droits, ses devis, ses
    // chantiers. Sans ce vidage, l'utilisateur suivant hérite des réponses du précédent — et
    // notamment de SES permissions, donc de boutons d'écriture qu'il n'a pas.
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, isAuthenticated: Boolean(state.token), login, setSession, logout }),
    [state, login, setSession, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
