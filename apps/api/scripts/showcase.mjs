#!/usr/bin/env node
/**
 * Opération exemple COMPLÈTE (devis → chantier → facturation), pilotée via l'API HTTP.
 *
 * Construit dans le tenant « demo » une affaire riche pour vérifier toutes les fonctionnalités :
 * bibliothèque multi-natures, ouvrages composés (avec sous-ouvrage et %), corps de devis
 * hiérarchique (titres, ouvrage biblio, ligne manuelle, option, variante), feuille de vente
 * (FG/bénéfice par nature + frais annexes + remise + TVA), workflow gagné, acceptation → chantier
 * + marché en arbre, contre-étude (renégo PU, quantité, ressource propre, ouvrage ajouté),
 * avancement par ouvrage, achats imputés aux ouvrages, pointages, situations ligne par ligne,
 * reprise de l'avancement depuis les situations, avenant, DGD.
 *
 * Prérequis : l'API tourne (par défaut http://localhost:3001) et le tenant demo existe
 * (login admin@demo.test / demo1234). Idempotent : si l'affaire SHOWCASE existe déjà, sort.
 *
 * Lancer :  node apps/api/scripts/showcase.mjs   (ou API_URL=http://localhost:3001 node ...)
 */

const API = process.env.API_URL ?? 'http://localhost:3001';
const SLUG = process.env.TENANT_SLUG ?? 'demo';
const EMAIL = process.env.SEED_EMAIL ?? 'admin@demo.test';
const PASSWORD = process.env.SEED_PASSWORD ?? 'demo1234';
// Code de l'affaire ET de la bibliothèque produites. Paramétrable pour pouvoir générer un second
// scénario — ou en éprouver un — sans écraser celui qui est déjà en place.
const AFFAIRE_CODE = process.env.SHOWCASE_CODE ?? 'SHOWCASE';
const LIB_CODE = `BIB-${AFFAIRE_CODE}`;

let TOKEN = '';
async function api(method, path, body, { raw = false } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      ...(path === '/auth/login' ? { 'X-Tenant-Slug': SLUG } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
  }
  return raw ? data : data;
}
const log = (...a) => console.log('[showcase]', ...a);

async function main() {
  // 1) Login
  const auth = await api('POST', '/auth/login', { email: EMAIL, password: PASSWORD });
  TOKEN = auth.accessToken;
  log('connecté', EMAIL);

  // Garde d'idempotence
  const affaires = await api('GET', '/affaires');
  const rows = Array.isArray(affaires) ? affaires : affaires.rows ?? [];
  if (rows.some((a) => a.code === AFFAIRE_CODE)) {
    log(`L'affaire ${AFFAIRE_CODE} existe déjà — rien à faire. (Supprimez-la pour régénérer.)`);
    return;
  }

  // 2) Bibliothèque multi-natures (codes préfixés SHW- pour ne pas heurter le seed démo — codes uniques par tenant)
  const libs = await api('GET', '/libraries').then((d) => (Array.isArray(d) ? d : d.rows ?? []));
  const existingLib = libs.find((l) => l.code === LIB_CODE);
  const lib = existingLib ?? (await api('POST', '/libraries', { code: LIB_CODE, name: 'Bibliothèque démonstration' }));
  const listOf = (d) => (Array.isArray(d) ? d : d.rows ?? []);
  const existingRes = new Map(listOf(await api('GET', `/libraries/${lib.id}/resources`)).map((r) => [r.code, r.id]));
  const existingOuv = new Map(listOf(await api('GET', `/libraries/${lib.id}/ouvrages`)).map((o) => [o.code, o.id]));
  const R = {};
  const addRes = async (code, label, unit, nature, unitCost) => {
    const c = `SHW-${code}`;
    R[code] = existingRes.get(c) ?? (await api('POST', `/libraries/${lib.id}/resources`, { code: c, label, unit, nature, unitCost })).id;
  };
  await addRes('MO-MACON', 'Maçon', 'H', 'labor', '38.50');
  await addRes('MO-COFF', 'Coffreur', 'H', 'labor', '42.00');
  await addRes('MO-PEINT', 'Peintre', 'H', 'labor', '35.00');
  await addRes('MAT-BETON', 'Béton C25/30', 'M3', 'material', '120.00');
  await addRes('MAT-ACIER', 'Acier HA', 'KG', 'material', '1.35');
  await addRes('MAT-PARP', 'Parpaing 20', 'U', 'material', '1.20');
  await addRes('MAT-ENDUIT', 'Enduit', 'KG', 'material', '2.00');
  await addRes('MAT-PEINT', 'Peinture acrylique', 'L', 'material', '8.00');
  await addRes('LOC-GRUE', 'Location grue', 'J', 'equipment', '350.00');
  await addRes('ST-ETANCH', 'Étanchéité (sous-traitance)', 'M2', 'subcontract', '45.00');
  log('bibliothèque : 10 ressources');

  // 3) Ouvrages composés (dont un sous-ouvrage et des %). Les composants ne sont ajoutés qu'à la création.
  const O = {};
  const comp = (ouvId, body) => api('POST', `/ouvrages/${ouvId}/components`, body);
  const defOuv = async (code, label, unit, components) => {
    const c = `SHW-${code}`;
    const existed = existingOuv.get(c);
    const id = existed ?? (await api('POST', `/libraries/${lib.id}/ouvrages`, { code: c, label, unit })).id;
    O[code] = id;
    if (!existed) for (const b of components()) await comp(id, b);
  };
  await defOuv('OUV-SEM', 'Semelle béton armé', 'M3', () => [
    { kind: 'resource', childResourceId: R['MAT-BETON'], quantity: '1.05' },
    { kind: 'resource', childResourceId: R['MAT-ACIER'], quantity: '90' },
    { kind: 'resource', childResourceId: R['MO-MACON'], quantity: '2.5' },
    { kind: 'percentage', rate: '0.03' },
  ]);
  await defOuv('OUV-MUR', 'Mur en parpaing', 'M2', () => [
    { kind: 'resource', childResourceId: R['MAT-PARP'], quantity: '12.5' },
    { kind: 'resource', childResourceId: R['MO-MACON'], quantity: '1.2' },
    { kind: 'resource', childResourceId: R['MAT-ACIER'], quantity: '5' },
    { kind: 'percentage', rate: '0.02' },
  ]);
  await defOuv('OUV-END', 'Enduit de façade', 'M2', () => [
    { kind: 'resource', childResourceId: R['MAT-ENDUIT'], quantity: '3' },
    { kind: 'resource', childResourceId: R['MO-PEINT'], quantity: '0.5' },
  ]);
  await defOuv('OUV-PEINT', 'Peinture murs', 'M2', () => [
    { kind: 'resource', childResourceId: R['MAT-PEINT'], quantity: '0.3' },
    { kind: 'resource', childResourceId: R['MO-PEINT'], quantity: '0.4' },
  ]);
  await defOuv('OUV-FOND', 'Fondations complètes', 'ENS', () => [
    { kind: 'sub_ouvrage', childOuvrageId: O['OUV-SEM'], quantity: '4' },
    { kind: 'resource', childResourceId: R['LOC-GRUE'], quantity: '2' },
  ]);
  await defOuv('OUV-ETANCH', 'Étanchéité toiture', 'M2', () => [
    { kind: 'resource', childResourceId: R['ST-ETANCH'], quantity: '1' },
    { kind: 'resource', childResourceId: R['MO-MACON'], quantity: '0.15' },
  ]);
  log('ouvrages : 5 + 1 composite (sous-ouvrage)');

  // 4) Affaire + devis + corps hiérarchique
  const created = await api('POST', '/affaires', { code: AFFAIRE_CODE, name: 'Résidence Les Tilleuls — R+2' });
  const versionId = created.version.id;
  const devisId = created.devis.id;
  const line = (body) => api('POST', `/versions/${versionId}/lines`, body);
  // Insère un ouvrage depuis la bibliothèque en COPIANT son sous-détail (ressources + ratios + prix)
  // en lignes enfants éditables — c'est la constitution de l'ouvrage, visible dans le déboursé.
  const ouvrageLine = async (code, designation, ouvId, quantity, parentLineId) => {
    const res = await api('POST', `/versions/${versionId}/ouvrages`, { ouvrageId: ouvId, quantity, designation, parentLineId });
    await api('PATCH', `/lines/${res.ouvrage.id}`, { code });
    return { id: res.ouvrage.id };
  };

  const t1 = (await line({ type: 'titre', code: '1', designation: 'GROS ŒUVRE' })).id;
  await ouvrageLine('1.1', 'Semelles filantes', O['OUV-SEM'], '25', t1);
  await ouvrageLine('1.2', 'Murs d’élévation', O['OUV-MUR'], '180', t1);
  await ouvrageLine('1.3', 'Fondations (composite)', O['OUV-FOND'], '1', t1);
  // Ligne manuelle (valorisée à la main, hors bibliothèque)
  const manual = await line({ type: 'ouvrage', code: '1.4', designation: 'Dalle portée (forfait)', quantity: '1', nature: 'material', parentLineId: t1 });
  await api('PUT', `/versions/${versionId}/lines/${manual.id}/pv`, { puVente: '8500', force: true });

  const t2 = (await line({ type: 'titre', code: '2', designation: 'FINITIONS' })).id;
  await ouvrageLine('2.1', 'Enduit façade', O['OUV-END'], '180', t2);
  await ouvrageLine('2.2', 'Peinture intérieure', O['OUV-PEINT'], '350', t2);
  const optLine = await ouvrageLine('2.3', 'OPTION — Peinture premium', O['OUV-PEINT'], '350', t2);
  const varLine = await ouvrageLine('2.4', 'VARIANTE — Enduit taloché', O['OUV-END'], '180', t2);
  await api('PUT', `/lines/${optLine.id}/section`, { sectionType: 'option' });
  await api('PUT', `/lines/${varLine.id}/section`, { sectionType: 'variante' });

  const t3 = (await line({ type: 'titre', code: '3', designation: 'VRD / ÉTANCHÉITÉ' })).id;
  await ouvrageLine('3.1', 'Étanchéité toiture (sous-traitance)', O['OUV-ETANCH'], '120', t3);
  log('corps du devis : 3 titres, ouvrages avec sous-détail + ligne manuelle + option + variante');

  // 5) Feuille de vente : FG/bénéfice par nature + frais annexes + remise + TVA
  await api('PUT', `/versions/${versionId}/sale-sheet`, {
    byNature: {
      labor: { tauxFg: '0.10', tauxBenefice: '0.08' },
      material: { tauxFg: '0.05', tauxBenefice: '0.12' },
      equipment: { tauxFg: '0.05', tauxBenefice: '0.10' },
      subcontract: { tauxFg: '0.03', tauxBenefice: '0.05' },
    },
    remise: { type: 'pct', valeur: '0.03' },
    tvaRate: '0.20',
  });
  await api('PUT', `/versions/${versionId}/frais-annexes`, {
    frais: [
      { designation: 'Assurance chantier', type: 'pct', valeur: '0.02' },
      { designation: 'Installation de chantier', type: 'fixe', valeur: '1500' },
    ],
  });
  const fv = await api('GET', `/versions/${versionId}/sale-sheet`);
  log(`feuille de vente : total HT ${fv.totalPvHt ?? '?'} €`);

  // 6) Workflow → gagné
  // Cycle commercial actuel (migration 072) : les étapes « étude » et « coefficients » ont été
  // retirées du workflow — elles décrivaient l'avancement du chiffrage, pas l'état commercial.
  for (const to of ['sent', 'won']) {
    await api('POST', `/devis/${devisId}/transition`, { to });
  }
  log('devis marqué GAGNÉ');

  // 7) Acceptation → chantier + marché (arbre)
  const acc = await api('POST', `/devis/${devisId}/accept`, {});
  const chantierId = acc.chantier.id;
  const marcheId = acc.marche.id;
  log(`accepté : chantier ${acc.chantier.code}, marché ${acc.marche.code}`);

  // Helpers d'exécution
  const tree = () => api('GET', `/chantiers/${chantierId}/execution-tree`);
  const ouvragesOf = async () => {
    const d = await tree();
    const out = [];
    const walk = (n) => { if (n.type === 'ouvrage') out.push(n); (n.children ?? []).forEach(walk); };
    d.marches.forEach((m) => m.lines.forEach(walk));
    return out;
  };

  // 8) Contre-étude : valider l'étude, renégocier, modifier, ajouter
  await api('POST', `/marches/${marcheId}/etude/validate`);
  const nomenc = await api('GET', `/chantiers/${chantierId}/nomenclature`);
  const beton = nomenc.find((n) => n.code === 'MAT-BETON');
  if (beton) await api('PUT', `/chantiers/${chantierId}/nomenclature/${beton.id}`, { unitCostObjectif: '128' });
  const semelle = (await ouvragesOf()).find((o) => /Semelle/.test(o.designation));
  if (semelle) {
    await api('POST', `/execution-lines/${semelle.id}/components`, {
      code: 'LOC-BENNE', label: 'Location benne (chantier)', unit: 'J', nature: 'equipment', unitCost: '80', quantity: '3',
    });
  }
  await api('POST', `/marches/${marcheId}/execution-lines`, { code: 'IMP', designation: 'Imprévus terrassement', unit: 'ens', quantiteObjectif: '1' });
  await api('POST', `/marches/${marcheId}/contre-etude/validate`);
  log('contre-étude validée (renégo PU + ressource propre + ouvrage ajouté)');

  // 9) Avancement par ouvrage
  await api('POST', `/chantiers/${chantierId}/line-advancement/apply`, { pct: '0.4', marcheId });
  const murs = (await ouvragesOf()).find((o) => /Mur/.test(o.designation));
  if (murs) await api('POST', `/chantiers/${chantierId}/line-advancement`, { executionLineId: murs.id, pct: '0.7' });
  log('avancement : global 40 % + Murs 70 %');

  // 10) Achats imputés aux ouvrages
  const bc1 = await api('POST', `/chantiers/${chantierId}/purchase-orders`, { code: 'BC-BETON' });
  await api('POST', `/purchase-orders/${bc1.id}/lines`, {
    executionLineId: semelle?.id ?? null, nature: 'material', designation: 'Béton livré', quantity: '26', unitPrice: '125',
  });
  await api('POST', `/purchase-orders/${bc1.id}/validate`);
  await api('POST', `/purchase-orders/${bc1.id}/delivery-notes`, { code: 'BL-001' });
  await api('POST', `/purchase-orders/${bc1.id}/invoices`, {
    executionLineId: semelle?.id ?? null, code: 'FF-2026-001', nature: 'material', amountHt: '2600',
  });
  const bc2 = await api('POST', `/chantiers/${chantierId}/purchase-orders`, { code: 'BC-GRUE' });
  await api('POST', `/purchase-orders/${bc2.id}/lines`, {
    executionLineId: murs?.id ?? null, nature: 'equipment', designation: 'Location grue', quantity: '5', unitPrice: '360',
  });
  await api('POST', `/purchase-orders/${bc2.id}/validate`);
  log('achats : 2 BC validés (engagé) + 1 facture (réalisé), imputés aux ouvrages');

  // 11) Pointages imputés
  if (murs) {
    await api('POST', `/chantiers/${chantierId}/timesheets`, {
      executionLineId: murs.id, employee: 'Équipe maçonnerie', date: '2026-06-15', hours: '120', hourlyCost: '39',
    });
  }
  log('pointages : 120 h imputées aux Murs');

  // 12) Situations ligne par ligne
  const marcheLines = (await api('GET', `/marches/${marcheId}`)).lines.filter((l) => l.type === 'ouvrage');
  const pctFor = (designation, pct) => {
    const ml = marcheLines.find((l) => new RegExp(designation).test(l.designation));
    return ml ? [{ marcheLineId: ml.id, pctAvancement: pct }] : [];
  };
  await api('POST', `/marches/${marcheId}/situations`, {
    retenueRate: '0.05', tvaRate: '0.20', revisionCoefficient: '1',
    lines: [
      ...pctFor('Semelles', '0.5'),
      ...pctFor('Murs', '0.4'),
      ...pctFor('Enduit', '0.2'),
    ],
  });
  await api('POST', `/marches/${marcheId}/situations`, {
    retenueRate: '0.05', tvaRate: '0.20', revisionCoefficient: '1.02',
    lines: [
      ...pctFor('Semelles', '0.8'),
      ...pctFor('Murs', '0.65'),
      ...pctFor('Enduit', '0.4'),
      ...pctFor('Peinture intérieure', '0.15'),
    ],
  });
  log('2 situations créées (avancement ligne par ligne, retenue 5 %, révision)');

  // 13) Reprise de l'avancement depuis les situations (proposition, modifiable)
  await api('POST', `/chantiers/${chantierId}/line-advancement/from-situations`);
  log('avancement d’exécution repris depuis les situations');

  // 14) Avenant
  await api('POST', `/marches/${marcheId}/avenants`, {
    label: 'Travaux supplémentaires — reprise réseau',
    lines: [{ designation: 'Reprise réseau EU', unit: 'ML', quantite: '35', pu: '48' }],
  });
  log('avenant créé');

  // 15) DGD
  await api('POST', `/marches/${marcheId}/dgd`, {});
  log('DGD généré');

  console.log('\n=== OPÉRATION EXEMPLE PRÊTE ===');
  console.log(`Affaire   : ${AFFAIRE_CODE} — Résidence Les Tilleuls`);
  console.log(`Chantier  : /chantiers/${chantierId}`);
  console.log(`  Structure & budget : /chantiers/${chantierId}/structure`);
  console.log(`  Achats             : /chantiers/${chantierId}/achats`);
  console.log(`  Avancement         : /chantiers/${chantierId}/avancement`);
  console.log(`  Pilotage           : /chantiers/${chantierId}/pilotage`);
  console.log(`Facturation (marché) : /invoicing/${marcheId}`);
  console.log('Connexion : admin@demo.test / demo1234 (tenant demo)\n');
}

main().catch((err) => {
  console.error('[showcase] échec :', err.message);
  process.exit(1);
});
