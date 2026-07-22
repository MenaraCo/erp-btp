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
