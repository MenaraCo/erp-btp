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

const DEMO_SLUG = 'demo';
const DEMO_EMAIL = 'admin@demo.test';
const DEMO_PASSWORD = 'demo1234';

/**
 * Demo dataset (cahier des charges §9): a realistic library + a fully costed affaire.
 * Reuses the real services (recalcul ascendant, métré, feuille de vente) for full fidelity.
 * Idempotent guard: skips if the demo tenant already exists.
 */
export async function seedDemo(app: INestApplicationContext): Promise<void> {
  const ds = app.get(DataSource);
  const context = app.get(TenantContext);

  const existing = await ds.query(`SELECT id FROM tenant WHERE slug = $1`, [DEMO_SLUG]);
  if (existing.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`[demo] tenant "${DEMO_SLUG}" already exists — skipping.`);
    return;
  }

  const tenant = (
    await ds.query(`INSERT INTO tenant (slug, name) VALUES ($1, $2) RETURNING id`, [
      DEMO_SLUG,
      'Entreprise Démo BTP',
    ])
  )[0];
  const tenantId = tenant.id as string;

  const subscriptions = app.get(SubscriptionService);
  const auth = app.get(AuthService);
  const rbac = app.get(RbacService);
  const entitlements = app.get(EntitlementsService);
  const libraries = app.get(LibrariesService);
  const ouvrages = app.get(OuvragesService);
  const devis = app.get(DevisService);
  const vente = app.get(VenteService);

  await context.run({ tenantId }, async () => {
    // Entitlements: trial opens all modules; create an admin user with a seat.
    await subscriptions.startTrial(tenantId);
    const userId = (
      await runInTenant(ds, tenantId, (em) =>
        em.query(
          `INSERT INTO user_account (tenant_id, email, full_name) VALUES ($1, $2, $3) RETURNING id`,
          [tenantId, DEMO_EMAIL, 'Admin Démo'],
        ),
      )
    )[0].id as string;
    await auth.setPassword(tenantId, userId, DEMO_PASSWORD);
    await rbac.provisionSystemRoles(tenantId);
    await rbac.assignRole(tenantId, userId, 'admin');
    await entitlements.assignSeat(tenantId, 'estimating', userId);
    await entitlements.assignSeat(tenantId, 'core', userId);

    // Library + resources.
    const lib = await libraries.createLibrary({ code: 'BIB-GO', name: 'Bibliothèque gros œuvre' });
    const macon = await libraries.createResource(lib.id, {
      code: 'MO-MACON', label: 'Maçon', unit: 'h', nature: 'labor', unitCost: '38.5000',
    });
    const beton = await libraries.createResource(lib.id, {
      code: 'MAT-BETON', label: 'Béton C25/30', unit: 'm3', nature: 'material', unitCost: '120.0000',
    });
    const acier = await libraries.createResource(lib.id, {
      code: 'MAT-ACIER', label: 'Acier HA', unit: 'kg', nature: 'material', unitCost: '1.3500',
    });
    const parpaing = await libraries.createResource(lib.id, {
      code: 'MAT-PARPAING', label: 'Parpaing 20', unit: 'u', nature: 'material', unitCost: '0.8500',
    });

    // Ouvrage SEMELLE (m3) + MUR (m2), with percentage "petites fournitures".
    const semelle = await ouvrages.createOuvrage(lib.id, { code: 'SEMELLE', label: 'Semelle béton armé', unit: 'm3' });
    await ouvrages.addComponent(semelle.id, { kind: 'resource', childResourceId: beton.id, quantity: '1.05' });
    await ouvrages.addComponent(semelle.id, { kind: 'resource', childResourceId: acier.id, quantity: '90' });
    await ouvrages.addComponent(semelle.id, { kind: 'resource', childResourceId: macon.id, quantity: '2.5' });
    const semelleFinal = await ouvrages.addComponent(semelle.id, { kind: 'percentage', rate: '0.03' });

    const mur = await ouvrages.createOuvrage(lib.id, { code: 'MUR-PARPAING', label: 'Mur parpaing 20', unit: 'm2' });
    await ouvrages.addComponent(mur.id, { kind: 'resource', childResourceId: parpaing.id, quantity: '12.5' });
    await ouvrages.addComponent(mur.id, { kind: 'resource', childResourceId: macon.id, quantity: '1.2' });
    const murFinal = await ouvrages.addComponent(mur.id, { kind: 'percentage', rate: '0.02' });

    // Affaire + devis tree + métré.
    const { affaire, version } = await devis.createAffaire({
      code: 'DEMO-2026-001', name: 'Construction maison individuelle',
      moa: 'M. et Mme Dupont',
    });
    await devis.setVariable(version.id, 'lineaire_semelle', 24);
    await devis.setVariable(version.id, 'surface_murs', 85);
    const titre = await devis.addLine(version.id, { type: 'titre', code: '1', designation: 'Gros œuvre', sortOrder: 1 });
    await devis.addLine(version.id, {
      type: 'ouvrage', parentLineId: titre.id, code: '1.1', designation: 'Semelles filantes',
      unit: 'm3', sourceOuvrageId: semelle.id, quantityFormula: 'lineaire_semelle * 0.5', sortOrder: 1,
    });
    await devis.addLine(version.id, {
      type: 'ouvrage', parentLineId: titre.id, code: '1.2', designation: 'Murs en élévation',
      unit: 'm2', sourceOuvrageId: mur.id, quantityFormula: 'surface_murs', sortOrder: 2,
    });

    // Feuille de vente coefficients.
    await vente.setSaleSheet(version.id, {
      byNature: { labor: '1.55', material: '1.18', equipment: '1.2', subcontract: '1.1' },
      fraisCoefficient: '1.1', tvaRate: '0.20',
    });

    const fv = await vente.computeForVersion(version.id);
    // eslint-disable-next-line no-console
    console.log(
      `[demo] tenant "${DEMO_SLUG}" (${tenantId})\n` +
        `       login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}\n` +
        `       affaire ${affaire.code} — déboursé SEMELLE=${semelleFinal.debourse}, MUR=${murFinal.debourse}\n` +
        `       feuille de vente: HT=${fv.totalPvHt} TVA=${fv.tva} TTC=${fv.totalTtc}`,
    );
  });
}
