'use client';

import {
  ParametresView,
  ONGLETS_SOCIETE,
} from '@/components/ParametresView';

/**
 * Écran Configuration : ce qui appartient à la SOCIÉTÉ et à aucun module en particulier —
 * identité de l'entreprise, couleurs, préférences d'affichage.
 *
 * Les référentiels métier (types de déboursé, plan analytique, unités) ont rejoint les Paramètres
 * de chaque module : on les règle là où l'on travaille.
 */
export default function ConfigurationPage() {
  return (
    <ParametresView
      onglets={ONGLETS_SOCIETE}
      titre="Configuration"
      sousTitre="Identité de la société et préférences d’affichage"
      note="Les référentiels métier — types de déboursé, familles, codes analytiques, lots, unités — se paramètrent désormais depuis les Paramètres de chaque module."
    />
  );
}
