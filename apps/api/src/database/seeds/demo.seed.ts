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
import { ANALYTICAL_PLAN_TEMPLATE } from '../../modules/analytical/analytical-plan.config';
import { ChantierService } from '../../modules/site-tracking/chantier.service';
import { PurchasingService } from '../../modules/site-tracking/purchasing.service';
import { TimesheetService } from '../../modules/site-tracking/timesheet.service';
import { AcceptanceService } from '../../modules/invoicing/acceptance.service';
import { AdvancementService } from '../../modules/financial-management/advancement.service';

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
  const acceptance = app.get(AcceptanceService);
  const advancement = app.get(AdvancementService);
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
    await ensureSampleChantier(ds, tenantId, { workflow, chantiers, acceptance, advancement, purchasing, timesheets, plan });

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
    byNature: {
      labor: { tauxFg: '10', tauxBenefice: '15' },
      material: { tauxFg: '8', tauxBenefice: '10' },
      equipment: { tauxFg: '10', tauxBenefice: '10' },
      subcontract: { tauxFg: '5', tauxBenefice: '5' },
    },
    tvaRate: '0.20',
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

/** Map : numéro de code analytique → id, depuis le plan modèle dupliqué du tenant. */
async function codesByNumber(plan: AnalyticalPlanService, tenantId: string): Promise<Map<string, string>> {
  const tree = await plan.getTree(tenantId);
  const m = new Map<string, string>();
  for (const n of tree) for (const l of n.lots) for (const f of l.familles) for (const c of f.codes) m.set(c.code, c.id);
  return m;
}

/**
 * Ensures the plan modèle's codes analytiques exist (idempotent). Needed for a demo tenant whose
 * plan was duplicated before the code-analytique level existed: ensurePlan sees a non-empty plan
 * and skips, so we add the template codes under their familles here.
 */
async function ensureTemplateCodes(plan: AnalyticalPlanService, tenantId: string): Promise<void> {
  await plan.ensurePlan(tenantId);
  const tree = await plan.getTree(tenantId);
  const famIdByCode = new Map<string, string>();
  const existingCodeNumbers = new Set<string>();
  for (const n of tree) for (const l of n.lots) for (const f of l.familles) {
    famIdByCode.set(f.code, f.id);
    for (const c of f.codes) existingCodeNumbers.add(c.code);
  }
  for (const lot of ANALYTICAL_PLAN_TEMPLATE) {
    for (const fam of lot.familles) {
      const famId = famIdByCode.get(fam.code);
      if (!famId) continue;
      for (const code of fam.codes) {
        if (!existingCodeNumbers.has(code.code)) {
          await plan.createCode({ familleId: famId, code: code.code, label: code.label });
        }
      }
    }
  }
}

/** Classifies the demo resources onto real analytical CODES (idempotent). Reclassifies resources
 *  still sitting in an auto-created "(à classer)" code. Parpaing is left unclassified on purpose
 *  to illustrate the "Non réparti" bucket. */
async function classifyResources(
  ds: DataSource,
  tenantId: string,
  plan: AnalyticalPlanService,
  libraries: LibrariesService,
): Promise<void> {
  await ensureTemplateCodes(plan, tenantId);
  const codeByNumber = await codesByNumber(plan, tenantId);

  const lib = (await runInTenant(ds, tenantId, (em) =>
    em.query(`SELECT id FROM library WHERE code = 'BIB-GO'`),
  ))[0];
  if (!lib) return;

  // ressource → code analytique du plan modèle (Béton=200, Aciers=210, MO maçonnerie=500)
  const mapping: Record<string, string> = {
    'MAT-BETON': '200',
    'MAT-ACIER': '210',
    'MO-MACON': '500',
  };
  for (const [resCode, codeNum] of Object.entries(mapping)) {
    const codeId = codeByNumber.get(codeNum);
    if (!codeId) continue;
    const res = (await runInTenant(ds, tenantId, (em) =>
      em.query(
        `SELECT r.id, c.code AS cur FROM resource r
           LEFT JOIN analytical_code c ON c.id = r.code_analytique_id
          WHERE r.code = $1 AND r.library_id = $2`,
        [resCode, lib.id],
      ),
    ))[0];
    if (res && (!res.cur || String(res.cur).startsWith('ACL-CODE-'))) {
      await libraries.classifyResource(lib.id, res.id, codeId);
    }
  }
}

/** Creates a sample chantier from the won demo affaire with a few imputed purchases (idempotent). */
async function ensureSampleChantier(
  ds: DataSource,
  tenantId: string,
  s: {
    workflow: WorkflowService;
    chantiers: ChantierService;
    acceptance: AcceptanceService;
    advancement: AdvancementService;
    purchasing: PurchasingService;
    timesheets: TimesheetService;
    plan: AnalyticalPlanService;
  },
): Promise<void> {
  const betonCode = (await codesByNumber(s.plan, tenantId)).get('200') ?? null;

  const already = await runInTenant(ds, tenantId, (em) => em.query(`SELECT id FROM chantier LIMIT 1`));
  let chantierId: string;

  if (already.length > 0) {
    chantierId = already[0].id;
    // Reconcile the engagé/réalisé imputation (non-destructive) onto the code analytique Bétons.
    if (betonCode) {
      await runInTenant(ds, tenantId, async (em) => {
        await em.query(
          `UPDATE purchase_order_line SET code_analytique_id = $1
            WHERE designation = 'Béton C25/30' AND code_analytique_id IS NULL`,
          [betonCode],
        );
        await em.query(
          `UPDATE supplier_invoice SET code_analytique_id = $1
            WHERE code = 'FF-2026-001' AND code_analytique_id IS NULL`,
          [betonCode],
        );
      });
    }
    // Demo chantier was transferred before the code-analytique level existed: align its
    // nomenclature once from the now-classified estimating resources (seed sync, not runtime).
    await runInTenant(ds, tenantId, (em) =>
      em.query(
        `UPDATE nomenclature_resource nr SET code_analytique_id = r.code_analytique_id
           FROM resource r
          WHERE nr.source_resource_id = r.id
            AND nr.chantier_id = $1
            AND nr.code_analytique_id IS NULL
            AND r.code_analytique_id IS NOT NULL`,
        [chantierId],
      ),
    );
  } else {
    const devis = (await runInTenant(ds, tenantId, (em) =>
      em.query(
        `SELECT d.id, d.status FROM devis d JOIN affaire a ON a.id = d.affaire_id
          WHERE a.code = 'DEMO-2026-001' ORDER BY d.sort_order ASC LIMIT 1`,
      ),
    ))[0];
    if (!devis) return;

    const path = ['study', 'coeffs_proposed', 'coeffs_validated', 'sent', 'won'];
    if (devis.status !== 'won') {
      for (const to of path) {
        await s.workflow.transition(devis.id, to);
      }
    }

    chantierId = (await s.acceptance.accept(devis.id)).chantier.id;

    // Engagé + réalisé imputés au code analytique Bétons.
    const order = await s.purchasing.createOrder(chantierId, { code: 'BC-2026-001' });
    await s.purchasing.addLine(order.id, {
      nature: 'material', designation: 'Béton C25/30', quantity: '12', unitPrice: '118',
      codeAnalytiqueId: betonCode,
    });
    // Une ligne non imputée (→ « Non réparti ») et une de frais de chantier (→ branche dédiée).
    await s.purchasing.addLine(order.id, { nature: 'material', designation: 'Divers', quantity: '1', unitPrice: '300' });
    await s.purchasing.addLine(order.id, { nature: 'site_overhead', designation: 'Installation de chantier', quantity: '1', unitPrice: '800' });
    await s.purchasing.validateOrder(order.id);
    await s.purchasing.receiveDelivery(order.id, 'BL-2026-001');
    await s.purchasing.addSupplierInvoice(order.id, {
      code: 'FF-2026-001', nature: 'material', amountHt: '1380', codeAnalytiqueId: betonCode,
    });

    // Réalisé main d'œuvre (pointage).
    await s.timesheets.create(chantierId, { employee: 'Équipe maçonnerie', date: '2026-05-15', hours: '40', hourlyCost: '40' });
  }

  // Forecast inputs (idempotent): validate each marché's contre-étude (initialise le prévisionnel)
  // et enregistre un avancement global, pour que la vue prévisionnelle soit réaliste.
  const marches = await runInTenant(ds, tenantId, (em) =>
    em.query(`SELECT id, execution_phase FROM marche WHERE chantier_id = $1`, [chantierId]),
  );
  for (const m of marches) {
    // étude → contre-étude → exécution (chaque validation est horodatée).
    if (m.execution_phase === 'etude') {
      await s.chantiers.validateEtude(m.id);
    }
    if (m.execution_phase !== 'execution') {
      await s.chantiers.validateContreEtude(m.id);
    }
  }
  const adv = await s.advancement.current(chantierId);
  if (!adv.global) {
    await s.advancement.record(chantierId, { pct: '0.35' });
  }
}
