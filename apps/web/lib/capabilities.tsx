'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './api';
import { useAuth } from './auth';

interface MyCapabilities {
  capabilities: string[];
  activeModules: string[];
}

/**
 * Capacités réellement ouvertes à l'utilisateur (module souscrit + jeton affecté). Le menu et les
 * écrans s'en servent pour présenter une entrée non souscrite comme telle plutôt que d'envoyer
 * l'utilisateur sur un 403. La décision d'accès reste celle du serveur : ceci n'est qu'un miroir.
 */
export function useCapabilities() {
  const { token } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['me-capabilities'],
    enabled: Boolean(token),
    staleTime: 5 * 60 * 1000,
    queryFn: () => apiFetch<MyCapabilities>('/me/capabilities', { token }),
  });
  const capabilities = data?.capabilities ?? [];
  return {
    isLoading,
    capabilities,
    activeModules: data?.activeModules ?? [],
    has: (cap: string) => capabilities.includes(cap),
    hasAny: (...caps: string[]) => caps.some((c) => capabilities.includes(c)),
  };
}

/** Capacités qui ouvrent l'acceptation de commande : facturer OU suivre des chantiers. */
export const ACCEPTANCE_CAPABILITIES = ['invoicing.situations', 'site_tracking.budget'];
