import { INestApplicationContext } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import { SubscriptionService } from '../../core/subscriptions/subscription.service';
import { AuthService } from '../../core/auth/auth.service';
import { RbacService } from '../../core/rbac/rbac.service';
import { EntitlementsService } from '../../core/entitlements/entitlements.service';
import { LibrariesService } from '../../modules/estimating/libraries.service';
import { OuvragesService } from '../../modules/estimating/ouvrages.service';
import { DevisService } from '../../modules/estimating/devis.service';
import { VenteService } from '../../modules/estimating/vente.service';
import { WorkflowService } from '../../modules/estimating/workflow.service';
import { AnalyticalPlanService } from '../../modules/analytical/analytical-plan.service';
import { ChantierService } from '../../modules/site-tracking/chantier.service';
import { PurchasingService } from '../../modules/site-tracking/purchasing.service';
import { TimesheetService } from '../../modules/site-tracking/timesheet.service';

const DEMO_SLUG = 'demo';
const DEMO_EMAIL = 'admin@demo.test';
const DEMO_PASSWORD = 'demo1234';

/** Modules a full demo account needs beyond core/estimating (added after the original seed). */
const EXTRA_MODULES = ['invoicing', 'site_tracking', 'financial_management'];

/**
 * Demo dataset (cahier des charges §9). Creates, on first run, a realistic library + a fully
 * costed affaire. On EVERY run it additively (and idempotently) ensures the demo account can
 * explore the whole chain: extra module seats, analytical classification of the resources, and a
 * sample chantier (won affaire → transfer + achats imputés) so the Chantiers + Gestion financière
 * dashboards show real data. Never destructive.
 */
export async function seedDemo(app: INestApplicationContext): Promise<void> {
  const ds = app.get(DataSource);
  const context = app.get(TenantContext);

  const existing = await ds.query(`SELECT id FROM tenant WHERE slug = $1`, [DEMO_SLUG]);
  const firstRun = existing.length === 0;

  const tenantId: string = firstRun
    ? (
        await ds.query(`INSERT INTO tenant (slug, name) VALUES ($1, $2) RETURNING id`, [
          DEMO_SLUG,
          'Entreprise Démo BTP',
        ])
      )[0].id
    : existing[0].id;

  const subscriptions = app.get(SubscriptionService);
  const auth = app.get(AuthService);
  const rbac = app.get(RbacService);
  const entitlements = app.get(EntitlementsService);
  const libraries = app.get(LibrariesService);
  const ouvrages = app.get(OuvragesService);
  const devis = app.get(DevisService);
  const vente = app.get(VenteService);
  const workflow = app.get(WorkflowService);
  const plan = app.get(AnalyticalPlanService);
  const chantiers = app.get(ChantierService);
  const purchasing = app.get(PurchasingService);
  const timesheets = app.get(TimesheetService);

  await context.run({ tenantId }, async () => {
    let userId: string;

    if (firstRun) {
      await subscriptions.startTrial(tenantId);
      userId = (
        await runInTenant(ds, tenantId, (em) =>
          em.query(
            `INSERT INTO user_account (tenant_id, email, full_name) VALUES ($1, $2, $3) RETURNING id`,
            [tenantId, DEMO_EMAIL, 'Admin Démo'],
          ),
        )
      )[0].id;
      await auth.setPassword(tenantId, userId, DEMO_PASSWORD);
      await rbac.provisionSystemRoles(tenantId);
      await rbac.assignRole(tenantId, userId, 'admin');
      await entitlements.assignSeat(tenantId, 'core', userId);
      await entitlements.assignSeat(tenantId, 'estimating', userId);

      await buildEstimatingDataset({ libraries, ouvrages, devis, vente });
    } else {
      userId = (
        await runInTenant(ds, tenantId, (em) =>
          em.query(`SELECT id FROM user_account WHERE email = $1`, [DEMO_EMAIL]),
        )
      )[0].id;
      // eslint-disable-next-line no-console
      console.log(`[demo] tenant "${DEMO_SLUG}" exists — applying additive enrichment.`);
    }

    // Reconcile the admin role with the current permission catalogue (site_tracking.*, financial.*,
    // invoicing.* were added after the original demo seed). Idempotent.
    await rbac.provisionSystemRoles(tenantId);
    await ensureModulesAndSeats(ds, tenantId, userId, entitlements);
    await classifyResources(ds, tenantId, plan, libraries);
    await ensureSampleChantier(ds, tenantId, { workflow, chantiers, purchasing, timesheets, plan });

    // eslint-disable-next-line no-console
    console.log(
      `[demo] ready — login ${DEMO_EMAIL} / ${DEMO_PASSWORD} (tenant slug "${DEMO_SLUG}").`,
    );
  });
}

async function buildEstimatingDataset(s: {
  libraries: LibrariesService;
  ouvrages: OuvragesService;
  devis: DevisService;
  vente: VenteService;
}): Promise<void> {
  const lib = await s.libraries.createLibrary({ code: 'BIB-GO', name: 'Bibliothèque gros œuvre' });
  const macon = await s.libraries.createResource(lib.id, {
    code: 'MO-MACON', label: 'Maçon', unit: 'h', nature: 'labor', unitCost: '38.5000',
  });
  const beton = await s.libraries.createResource(lib.id, {
    code: 'MAT-BETON', label: 'Béton C25/30', unit: 'm3', nature: 'material', unitCost: '120.0000',
  });
  const acier = await s.libraries.createResource(lib.id, {
    code: 'MAT-ACIER', label: 'Acier HA', unit: 'kg', nature: 'material', unitCost: '1.3500',
  });
  const parpaing = await s.libraries.createResource(lib.id, {
    code: 'MAT-PARPAING', label: 'Parpaing 20', unit: 'u', nature: 'material', unitCost: '0.8500',
  });

  const semelle = await s.ouvrages.createOuvrage(lib.id, { code: 'SEMELLE', label: 'Semelle béton armé', unit: 'm3' });
  await s.ouvrages.addComponent(semelle.id, { kind: 'resource', childResourceId: beton.id, quantity: '1.05' });
  await s.ouvrages.addComponent(semelle.id, { kind: 'resource', childResourceId: acier.id, quantity: '90' });
  await s.ouvrages.addComponent(semelle.id, { kind: 'resource', childResourceId: macon.id, quantity: '2.5' });
  await s.ouvrages.addComponent(semelle.id, { kind: 'percentage', rate: '0.03' });

  const mur = await s.ouvrages.createOuvrage(lib.id, { code: 'MUR-PARPAING', label: 'Mur parpaing 20', unit: 'm2' });
  await s.ouvrages.addComponent(mur.id, { kind: 'resource', childResourceId: parpaing.id, quantity: '12.5' });
  await s.ouvrages.addComponent(mur.id, { kind: 'resource', childResourceId: macon.id, quantity: '1.2' });
  await s.ouvrages.addComponent(mur.id, { kind: 'percentage', rate: '0.02' });

  const { version } = await s.devis.createAffaire({
    code: 'DEMO-2026-001', name: 'Construction maison individuelle', moa: 'M. et Mme Dupont',
  });
  await s.devis.setVariable(version.id, 'lineaire_semelle', 24);
  await s.devis.setVariable(version.id, 'surface_murs', 85);
  const titre = await s.devis.addLine(version.id, { type: 'titre', code: '1', designation: 'Gros œuvre', sortOrder: 1 });
  await s.devis.addLine(version.id, {
    type: 'ouvrage', parentLineId: titre.id, code: '1.1', designation: 'Semelles filantes',
    unit: 'm3', sourceOuvrageId: semelle.id, quantityFormula: 'lineaire_semelle * 0.5', sortOrder: 1,
  });
  await s.devis.addLine(version.id, {
    type: 'ouvrage', parentLineId: titre.id, code: '1.2', designation: 'Murs en élévation',
    unit: 'm2', sourceOuvrageId: mur.id, quantityFormula: 'surface_murs', sortOrder: 2,
  });
  await s.vente.setSaleSheet(version.id, {
    byNature: { labor: '1.55', material: '1.18', equipment: '1.2', subcontract: '1.1' },
    fraisCoefficient: '1.1', tvaRate: '0.20',
  });
}

/** Ensures the extra modules are active and the demo user holds a seat for each (idempotent). */
async function ensureModulesAndSeats(
  ds: DataSource,
  tenantId: string,
  userId: string,
  entitlements: EntitlementsService,
): Promise<void> {
  await runInTenant(ds, tenantId, async (em) => {
    const sub = await em.query(`SELECT id FROM subscription WHERE tenant_id = $1`, [tenantId]);
    const subscriptionId = sub[0]?.id ?? null;
    for (const code of EXTRA_MODULES) {
      await em.query(
        `INSERT INTO tenant_module (tenant_id, module_code, seats_purchased, active)
         VALUES ($1, $2, 5, true)
         ON CONFLICT (tenant_id, module_code) DO UPDATE SET active = true,
           seats_purchased = GREATEST(tenant_module.seats_purchased, 5)`,
        [tenantId, code],
      );
      if (subscriptionId) {
        const ms = await em.query(
          `SELECT id FROM module_subscription WHERE tenant_id = $1 AND module_code = $2`,
          [tenantId, code],
        );
        if (ms.length === 0) {
          await em.query(
            `INSERT INTO module_subscription
               (tenant_id, subscription_id, module_code, seats_purchased, billing_period)
             VALUES ($1, $2, $3, 5, 'trial')`,
            [tenantId, subscriptionId, code],
          );
        }
      }
    }
  });

  for (const code of EXTRA_MODULES) {
    const held = await runInTenant(ds, tenantId, (em) =>
      em.query(`SELECT 1 FROM seat_assignment WHERE module_code = $1 AND user_id = $2`, [code, userId]),
    );
    if (held.length === 0) {
      await entitlements.assignSeat(tenantId, code, userId);
    }
  }
}

/** Lots/familles the demo needs (the backfill only created "(à classer)" buckets, and ensurePlan
 *  then sees a non-empty plan and skips the template — so we create these explicitly). */
const DEMO_LOTS = [
  {
    nature: 'material' as const, code: 'MAT-GO', label: 'Gros œuvre',
    familles: [
      { code: 'MAT-GO-BET', label: 'Bétons' },
      { code: 'MAT-GO-ACI', label: 'Aciers' },
    ],
  },
  {
    nature: 'labor' as const, code: 'MO-PROD', label: 'Main d’œuvre production',
    familles: [{ code: 'MO-PROD-MAC', label: 'Maçons' }],
  },
];

/** Classifies the demo resources onto real analytical familles (idempotent). Reclassifies resources
 *  still sitting in an auto-created "(à classer)" bucket. Parpaing is left unclassified on purpose
 *  to illustrate the "Non réparti" bucket. */
async function classifyResources(
  ds: DataSource,
  tenantId: string,
  plan: AnalyticalPlanService,
  libraries: LibrariesService,
): Promise<void> {
  await plan.ensurePlan(tenantId);
  let tree = await plan.getTree(tenantId);
  const codes = new Set<string>();
  for (const n of tree) for (const l of n.lots) { codes.add(l.code); for (const f of l.familles) codes.add(f.code); }

  for (const lot of DEMO_LOTS) {
    let lotId: string | undefined;
    for (const n of tree) for (const l of n.lots) if (l.code === lot.code) lotId = l.id;
    if (!lotId) {
      lotId = (await plan.createLot({ nature: lot.nature, code: lot.code, label: lot.label }))
        .id as string;
    }
    const ensuredLotId: string = lotId;
    for (const fam of lot.familles) {
      if (!codes.has(fam.code)) {
        await plan.createFamille({ lotId: ensuredLotId, code: fam.code, label: fam.label });
      }
    }
  }
  tree = await plan.getTree(tenantId);
  const familleByCode = new Map<string, string>();
  for (const n of tree) for (const l of n.lots) for (const f of l.familles) familleByCode.set(f.code, f.id);

  const lib = (await runInTenant(ds, tenantId, (em) =>
    em.query(`SELECT id FROM library WHERE code = 'BIB-GO'`),
  ))[0];
  if (!lib) return;

  const mapping: Record<string, string> = {
    'MAT-BETON': 'MAT-GO-BET',
    'MAT-ACIER': 'MAT-GO-ACI',
    'MO-MACON': 'MO-PROD-MAC',
  };
  for (const [resCode, famCode] of Object.entries(mapping)) {
    const famId = familleByCode.get(famCode);
    if (!famId) continue;
    const res = (await runInTenant(ds, tenantId, (em) =>
      em.query(
        `SELECT r.id, f.code AS fam_code FROM resource r
           LEFT JOIN analytical_famille f ON f.id = r.famille_analytique_id
          WHERE r.code = $1 AND r.library_id = $2`,
        [resCode, lib.id],
      ),
    ))[0];
    // (re)classify if unclassified or still in an auto "(à classer)" bucket
    if (res && (!res.fam_code || String(res.fam_code).startsWith('ACL-'))) {
      await libraries.classifyResource(lib.id, res.id, famId);
    }
  }
}

/** Returns the analytical famille id for a code, or null. */
async function familleId(plan: AnalyticalPlanService, tenantId: string, code: string): Promise<string | null> {
  const tree = await plan.getTree(tenantId);
  for (const n of tree) for (const l of n.lots) for (const f of l.familles) if (f.code === code) return f.id;
  return null;
}

/** Creates a sample chantier from the won demo affaire with a few imputed purchases (idempotent). */
async function ensureSampleChantier(
  ds: DataSource,
  tenantId: string,
  s: {
    workflow: WorkflowService;
    chantiers: ChantierService;
    purchasing: PurchasingService;
    timesheets: TimesheetService;
    plan: AnalyticalPlanService;
  },
): Promise<void> {
  const betonFamille = await familleId(s.plan, tenantId, 'MAT-GO-BET');

  const already = await runInTenant(ds, tenantId, (em) => em.query(`SELECT id FROM chantier LIMIT 1`));
  if (already.length > 0) {
    // Chantier already seeded: reconcile the engagé/réalisé imputation if it was created before the
    // famille existed (non-destructive UPDATE on the demo's own rows).
    if (betonFamille) {
      await runInTenant(ds, tenantId, async (em) => {
        await em.query(
          `UPDATE purchase_order_line SET famille_analytique_id = $1
            WHERE designation = 'Béton C25/30' AND famille_analytique_id IS NULL`,
          [betonFamille],
        );
        await em.query(
          `UPDATE supplier_invoice SET famille_analytique_id = $1
            WHERE code = 'FF-2026-001' AND famille_analytique_id IS NULL`,
          [betonFamille],
        );
      });
    }
    return;
  }

  const affaire = (await runInTenant(ds, tenantId, (em) =>
    em.query(`SELECT id, status FROM affaire WHERE code = 'DEMO-2026-001'`),
  ))[0];
  if (!affaire) return;

  // Walk the workflow to "won" if not already there.
  const path = ['study', 'coeffs_proposed', 'coeffs_validated', 'sent', 'won'];
  if (affaire.status !== 'won') {
    for (const to of path) {
      await s.workflow.transition(affaire.id, to);
    }
  }

  const chantier = (await s.chantiers.transferFromAffaire(affaire.id)).chantier;

  // Engagé + réalisé imputés à la famille Bétons.
  const order = await s.purchasing.createOrder(chantier.id, { code: 'BC-2026-001' });
  await s.purchasing.addLine(order.id, {
    nature: 'material', designation: 'Béton C25/30', quantity: '12', unitPrice: '118',
    familleAnalytiqueId: betonFamille,
  });
  // Une ligne non imputée (→ « Non réparti ») et une de frais de chantier (→ branche dédiée).
  await s.purchasing.addLine(order.id, { nature: 'material', designation: 'Divers', quantity: '1', unitPrice: '300' });
  await s.purchasing.addLine(order.id, { nature: 'site_overhead', designation: 'Installation de chantier', quantity: '1', unitPrice: '800' });
  await s.purchasing.validateOrder(order.id);
  await s.purchasing.receiveDelivery(order.id, 'BL-2026-001');
  await s.purchasing.addSupplierInvoice(order.id, {
    code: 'FF-2026-001', nature: 'material', amountHt: '1380', familleAnalytiqueId: betonFamille,
  });

  // Réalisé main d'œuvre (pointage).
  await s.timesheets.create(chantier.id, { employee: 'Équipe maçonnerie', date: '2026-05-15', hours: '40', hourlyCost: '40' });
}
