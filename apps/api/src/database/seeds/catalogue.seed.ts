import { DataSource } from 'typeorm';
import {
  CAPABILITIES,
  MODULES,
  PACKS,
  QUOTAS,
} from '../../core/catalog/catalog.config';

/**
 * Seeds the commercial catalogue from catalog.config.ts, reconciling the database with the
 * config (config is the source of truth). Idempotent: running it repeatedly converges to the
 * same state — upserts existing rows, inserts missing ones, removes rows no longer in config.
 * Runs in a single transaction with an owner connection.
 */
export async function seedCatalogue(dataSource: DataSource): Promise<void> {
  // Validate the config before touching the database.
  const capabilityKeys = new Set(CAPABILITIES.map((c) => c.key));
  for (const m of MODULES) {
    for (const key of m.capabilities) {
      if (!capabilityKeys.has(key)) {
        throw new Error(`Module "${m.code}" references unknown capability "${key}"`);
      }
    }
  }
  const moduleCodes = new Set(MODULES.map((m) => m.code));
  for (const p of PACKS) {
    for (const code of p.modules) {
      if (!moduleCodes.has(code)) {
        throw new Error(`Pack "${p.code}" references unknown module "${code}"`);
      }
    }
  }

  const qr = dataSource.createQueryRunner();
  await qr.connect();
  await qr.startTransaction();
  try {
    // 1) Clear join tables (rebuilt from config at the end).
    await qr.query(`DELETE FROM module_capability`);
    await qr.query(`DELETE FROM pack_module`);

    // 2) Upsert leaf catalogue rows, then drop those no longer in config.
    for (const c of CAPABILITIES) {
      await qr.query(
        `INSERT INTO capability (key, label) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label, updated_at = now()`,
        [c.key, c.label],
      );
    }
    await qr.query(`DELETE FROM capability WHERE key <> ALL($1::text[])`, [
      CAPABILITIES.map((c) => c.key),
    ]);

    for (const m of MODULES) {
      // price_monthly is seeded on INSERT only: after the first seed the database owns pricing
      // (editable from the editor back-office), so a re-seed must never wipe the editor's prices.
      // min_tier_level relève en revanche de la structure de l'offre : réconcilié à chaque seed.
      await qr.query(
        `INSERT INTO module (code, label, is_addon, active, price_monthly, min_tier_level)
         VALUES ($1, $2, $3, true, $4, $5)
         ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, is_addon = EXCLUDED.is_addon,
                                          min_tier_level = EXCLUDED.min_tier_level, updated_at = now()`,
        [m.code, m.label, m.isAddon, m.priceMonthly, m.minTierLevel ?? null],
      );
    }
    await qr.query(`DELETE FROM module WHERE code <> ALL($1::text[])`, [
      MODULES.map((m) => m.code),
    ]);

    for (const p of PACKS) {
      // Comme pour les modules : le prix n'est posé qu'à l'INSERT (la base fait foi ensuite,
      // l'éditeur l'ajuste depuis le back-office) ; le rang du palier suit la configuration.
      await qr.query(
        `INSERT INTO pack (code, label, discount_pct, active, price_monthly, tier_level)
         VALUES ($1, $2, $3, true, $4, $5)
         ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, discount_pct = EXCLUDED.discount_pct,
                                          tier_level = EXCLUDED.tier_level, updated_at = now()`,
        [p.code, p.label, p.discountPct, p.priceMonthly, p.tierLevel],
      );
    }
    await qr.query(`DELETE FROM pack WHERE code <> ALL($1::text[])`, [
      PACKS.map((p) => p.code),
    ]);

    for (const q of QUOTAS) {
      await qr.query(
        `INSERT INTO quota_definition (key, label, unit) VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label, unit = EXCLUDED.unit, updated_at = now()`,
        [q.key, q.label, q.unit],
      );
    }
    await qr.query(`DELETE FROM quota_definition WHERE key <> ALL($1::text[])`, [
      QUOTAS.map((q) => q.key),
    ]);

    // 3) Rebuild join tables from config, resolving ids by code/key.
    const moduleIdByCode = await idMap(qr, `SELECT id, code AS k FROM module`);
    const capabilityIdByKey = await idMap(qr, `SELECT id, key AS k FROM capability`);
    const packIdByCode = await idMap(qr, `SELECT id, code AS k FROM pack`);

    for (const m of MODULES) {
      for (const key of m.capabilities) {
        await qr.query(
          `INSERT INTO module_capability (module_id, capability_id) VALUES ($1, $2)`,
          [moduleIdByCode.get(m.code), capabilityIdByKey.get(key)],
        );
      }
    }
    for (const p of PACKS) {
      for (const code of p.modules) {
        await qr.query(
          `INSERT INTO pack_module (pack_id, module_id) VALUES ($1, $2)`,
          [packIdByCode.get(p.code), moduleIdByCode.get(code)],
        );
      }
    }

    await qr.commitTransaction();
  } catch (error) {
    await qr.rollbackTransaction();
    throw error;
  } finally {
    await qr.release();
  }
}

async function idMap(
  qr: { query: (sql: string) => Promise<Array<{ id: string; k: string }>> },
  sql: string,
): Promise<Map<string, string>> {
  const rows = await qr.query(sql);
  return new Map(rows.map((r) => [r.k, r.id]));
}
