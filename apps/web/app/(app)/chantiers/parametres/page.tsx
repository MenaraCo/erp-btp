'use client';

import { ParametresView, ONGLETS_PLAN_ANALYTIQUE } from '@/components/ParametresView';

/**
 * Paramètres du module Chantier : le plan analytique, que le conducteur règle depuis son module
 * plutôt que depuis la Configuration.
 *
 * Le plan est le MÊME que celui de l'étude de prix — volontairement. C'est la colonne commune qui
 * permet de comparer le budget prévu au réalisé ; deux plans distincts n'auraient plus rien à
 * confronter.
 */
export default function ParametresChantierPage() {
  return (
    <ParametresView
      onglets={ONGLETS_PLAN_ANALYTIQUE}
      titre="Paramètres — Chantier"
      sousTitre="Plan analytique et unités"
      note="Ce plan analytique est commun à toute la société : c’est ce qui permet de comparer le budget prévu à l’étude et le réalisé du chantier. Ce que vous modifiez ici se retrouve côté étude de prix, et inversement."
    />
  );
}
