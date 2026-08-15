import { computePricing, normaliseBilling, applyPromoDiscount } from './pricing.calc';

/** Panier de référence : Études de prix 39 € × 2 + Facturation 29 € × 1 = 107 €/mois catalogue. */
const LINES = [
  { seats: 2, unitPrice: 39 },
  { seats: 1, unitPrice: 29 },
];
const base = (over: Partial<Parameters<typeof computePricing>[0]> = {}) =>
  computePricing({
    lines: LINES,
    billingTerm: 'monthly',
    billingInterval: 'monthly',
    annualDiscountPct: 10,
    ...over,
  });

describe('Tarification — engagement, rythme de facturation et cascade de remises', () => {
  it('mensuel_sans_engagement_facture_le_prix_catalogue', () => {
    const p = base();
    expect(p.monthlyBase).toBe(107);
    expect(p.termDiscountPct).toBe(0);
    expect(p.monthlyNet).toBe(107);
    expect(p.amountPerInvoice).toBe(107);
    expect(p.commitmentMonths).toBe(0);
  });

  it('annuel_paye_annuellement_applique_10_pct_sur_douze_mois', () => {
    const p = base({ billingTerm: 'annual', billingInterval: 'yearly' });
    // 107 × 12 × 0,9 = 1155,60
    expect(p.monthlyAfterTerm).toBe(96.3);
    expect(p.amountPerInvoice).toBe(1155.6);
    expect(p.commitmentMonths).toBe(12);
  });

  it('annuel_mensualise_applique_la_meme_remise_par_mois', () => {
    const p = base({ billingTerm: 'annual', billingInterval: 'monthly' });
    expect(p.monthlyNet).toBe(96.3); // 107 − 10 %
    expect(p.amountPerInvoice).toBe(96.3); // prélevé chaque mois
    expect(p.commitmentMonths).toBe(12); // mais engagé 12 mois
  });

  it('mrr_est_toujours_l_equivalent_mensuel_quel_que_soit_le_rythme', () => {
    const mensualise = base({ billingTerm: 'annual', billingInterval: 'monthly' });
    const annuel = base({ billingTerm: 'annual', billingInterval: 'yearly' });
    expect(annuel.mrr).toBe(mensualise.mrr);
    expect(annuel.mrr).toBe(96.3);
  });

  it('cascade_remise_annuelle_puis_code_promo_pourcentage', () => {
    // 107 → 96,30 (annuel −10 %) → 77,04 (promo −20 % sur le montant déjà remisé)
    const p = base({
      billingTerm: 'annual',
      billingInterval: 'monthly',
      promo: { discountType: 'percent', discountValue: 20 },
    });
    expect(p.monthlyAfterTerm).toBe(96.3);
    expect(p.monthlyNet).toBe(77.04);
  });

  it('cascade_remise_annuelle_puis_code_promo_montant_fixe', () => {
    // 107 → 96,30 → 81,30 (−15 €)
    const p = base({
      billingTerm: 'annual',
      billingInterval: 'monthly',
      promo: { discountType: 'fixed', discountValue: 15 },
    });
    expect(p.monthlyNet).toBe(81.3);
  });

  it('code_promo_seul_s_applique_aussi_au_mensuel_sans_engagement', () => {
    const p = base({ promo: { discountType: 'percent', discountValue: 20 } });
    expect(p.monthlyNet).toBe(85.6); // 107 − 20 %
  });

  it('code_promo_reserve_a_l_annuel_ne_joue_pas_sur_le_mensuel', () => {
    // Portée « annual » mais formule mensuelle : le promo est ignoré, prix catalogue plein.
    const p = base({ promo: { discountType: 'percent', discountValue: 20, appliesTo: 'annual' } });
    expect(p.monthlyNet).toBe(107);
  });

  it('code_promo_reserve_a_l_annuel_joue_sur_l_annuel', () => {
    // 107 → 96,30 (annuel −10 %) → 77,04 (promo −20 % réservé à l'annuel, applicable ici)
    const p = base({
      billingTerm: 'annual',
      billingInterval: 'yearly',
      promo: { discountType: 'percent', discountValue: 20, appliesTo: 'annual' },
    });
    expect(p.monthlyNet).toBe(77.04);
  });

  it('code_promo_reserve_au_mensuel_ne_joue_pas_sur_l_annuel', () => {
    const p = base({
      billingTerm: 'annual',
      billingInterval: 'yearly',
      promo: { discountType: 'percent', discountValue: 20, appliesTo: 'monthly' },
    });
    expect(p.monthlyNet).toBe(96.3); // seulement la remise d'engagement, pas le promo
  });

  it('promo_sans_duree_couvre_toute_la_periode_douze_mois', () => {
    // Comportement historique : la remise court sur les 12 mois, rien ne remonte ensuite.
    const p = base({
      billingTerm: 'annual',
      billingInterval: 'yearly',
      promo: { discountType: 'percent', discountValue: 20 },
    });
    expect(p.promoMonths).toBe(12);
    expect(p.promoLimited).toBe(false);
    expect(p.monthlyAfterPromo).toBe(77.04); // pas de retour au tarif plein
    expect(p.amountPerInvoice).toBe(924.48); // 77,04 × 12
  });

  it('promo_limitee_au_premier_mois_ne_remise_qu_un_mois_de_l_annuel', () => {
    // 107 → 96,30 (annuel −10 %). Le promo −20 % ne joue que sur 1 mois : −19,26 sur l'année.
    const p = base({
      billingTerm: 'annual',
      billingInterval: 'yearly',
      promo: { discountType: 'percent', discountValue: 20, durationMonths: 1 },
    });
    expect(p.promoMonths).toBe(1);
    expect(p.promoLimited).toBe(true);
    expect(p.monthlyNet).toBe(77.04); // pendant la remise
    expect(p.monthlyAfterPromo).toBe(96.3); // une fois la remise épuisée
    expect(p.firstYearTotal).toBe(1136.34); // 1 155,60 − 19,26
    expect(p.amountPerInvoice).toBe(1136.34); // payé en une fois
    expect(p.amountPerInvoiceAfterPromo).toBe(1155.6); // année suivante, sans promo
  });

  it('promo_limitee_a_deux_mois_en_annuel_mensualise_ne_remise_que_les_deux_premieres_factures', () => {
    const p = base({
      billingTerm: 'annual',
      billingInterval: 'monthly',
      promo: { discountType: 'percent', discountValue: 20, durationMonths: 2 },
    });
    expect(p.amountPerInvoice).toBe(77.04); // les 2 premières mensualités
    expect(p.amountPerInvoiceAfterPromo).toBe(96.3); // les 10 suivantes
    expect(p.firstYearTotal).toBe(1117.08); // 1 155,60 − (19,26 × 2)
  });

  it('duree_de_promo_est_plafonnee_a_douze_mois', () => {
    const p = base({
      billingTerm: 'annual',
      billingInterval: 'yearly',
      promo: { discountType: 'percent', discountValue: 20, durationMonths: 36 },
    });
    expect(p.promoMonths).toBe(12);
    expect(p.promoLimited).toBe(false);
  });

  it('economie_annuelle_tient_compte_d_une_promo_limitee', () => {
    const p = base({
      billingTerm: 'annual',
      billingInterval: 'yearly',
      promo: { discountType: 'percent', discountValue: 20, durationMonths: 1 },
    });
    expect(p.annualSavings).toBe(147.66); // 1 284 (catalogue) − 1 136,34 réellement payé
  });

  it('taux_de_remise_annuelle_est_parametrable', () => {
    const a15 = base({ billingTerm: 'annual', billingInterval: 'yearly', annualDiscountPct: 15 });
    expect(a15.monthlyAfterTerm).toBe(90.95); // 107 × 0,85
    const a0 = base({ billingTerm: 'annual', billingInterval: 'yearly', annualDiscountPct: 0 });
    expect(a0.monthlyAfterTerm).toBe(107);
  });

  it('economie_annuelle_reflete_l_ecart_au_tarif_catalogue', () => {
    const p = base({ billingTerm: 'annual', billingInterval: 'yearly' });
    expect(p.annualSavings).toBe(128.4); // (107 − 96,30) × 12
  });

  it('une_remise_ne_rend_jamais_le_montant_negatif', () => {
    const p = base({ promo: { discountType: 'fixed', discountValue: 10_000 } });
    expect(p.monthlyNet).toBe(0);
    expect(p.amountPerInvoice).toBe(0);
  });

  it('sans_engagement_le_rythme_annuel_est_ramene_au_mensuel', () => {
    expect(normaliseBilling('monthly', 'yearly')).toEqual({
      billingTerm: 'monthly',
      billingInterval: 'monthly',
    });
    const p = base({ billingTerm: 'monthly', billingInterval: 'yearly' });
    expect(p.amountPerInvoice).toBe(107); // et non ×12
  });

  it('panier_vide_donne_zero', () => {
    const p = base({ lines: [] });
    expect(p.monthlyBase).toBe(0);
    expect(p.monthlyNet).toBe(0);
  });

  it('applyPromoDiscount_arrondit_au_centime', () => {
    expect(applyPromoDiscount(96.3, { discountType: 'percent', discountValue: 20 })).toBe(77.04);
    expect(applyPromoDiscount(100, null)).toBe(100);
  });
});
