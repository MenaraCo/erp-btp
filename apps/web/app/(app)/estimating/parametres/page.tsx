'use client';

import {
  ParametresView,
  ONGLETS_ETUDE,
  ONGLETS_PLAN_ANALYTIQUE,
} from '@/components/ParametresView';

/**
 * Paramètres du module Étude de prix : les types de déboursé (propres au chiffrage) et le plan
 * analytique, que le deviseur règle sans passer par la Configuration.
 */
export default function ParametresEtudePage() {
  return (
    <ParametresView
      onglets={[...ONGLETS_ETUDE, ...ONGLETS_PLAN_ANALYTIQUE]}
      titre="Paramètres — Étude de prix"
      sousTitre="Types de déboursé et plan analytique"
      note="Le plan analytique (familles, codes, lots, unités) est commun à toute la société : c’est lui qui permet de comparer le prévu de l’étude au réalisé du chantier. Ce que vous modifiez ici se retrouve donc côté chantier, et inversement."
    />
  );
}
