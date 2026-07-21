import { Injectable, Logger } from '@nestjs/common';
import { frenchVatNumberFromSiren } from '../../modules/compliance/vat';

export interface CompanyMatch {
  siren: string;
  siret: string | null;
  name: string;
  legalForm: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  naf: string | null;
  vatIntra: string | null;
}

/**
 * Looks up French companies in the public government registry
 * (recherche-entreprises.api.gouv.fr — free, no token) by SIREN, SIRET or raison sociale, and
 * normalises the response for the app. This is a proxy over public data: it carries no tenant or
 * user data, so it needs no tenant context. The intra-community VAT number is derived by the
 * compliance module (fiscal rule), not here.
 */
@Injectable()
export class CompanyLookupService {
  private readonly logger = new Logger(CompanyLookupService.name);
  private static readonly BASE = 'https://recherche-entreprises.api.gouv.fr/search';

  async search(query: string): Promise<CompanyMatch[]> {
    const q = (query ?? '').trim();
    if (q.length < 3) return [];

    const url = `${CompanyLookupService.BASE}?q=${encodeURIComponent(q)}&page=1&per_page=10`;

    let payload: unknown;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) {
        this.logger.warn(`company lookup failed: HTTP ${res.status}`);
        return [];
      }
      payload = await res.json();
    } catch (err) {
      this.logger.warn(`company lookup error: ${(err as Error).message}`);
      return [];
    }

    const results = (payload as { results?: unknown[] })?.results ?? [];
    return results.map((r) => this.normalise(r as RawCompany)).filter((m): m is CompanyMatch => m !== null);
  }

  private normalise(r: RawCompany): CompanyMatch | null {
    const siren = r?.siren ?? null;
    if (!siren) return null;
    const siege = r.siege ?? {};
    const name = r.nom_complet || r.nom_raison_sociale || r.sigle || siren;
    return {
      siren,
      siret: siege.siret ?? null,
      name,
      legalForm: LEGAL_FORMS[r.nature_juridique ?? ''] ?? r.nature_juridique ?? null,
      address: this.buildAddress(siege),
      postalCode: siege.code_postal ?? null,
      city: siege.libelle_commune ?? null,
      naf: r.activite_principale ?? null,
      vatIntra: frenchVatNumberFromSiren(siren),
    };
  }

  /** Prefers the pre-formatted `adresse`; otherwise rebuilds the street part from its components. */
  private buildAddress(siege: RawSiege): string | null {
    if (siege.adresse) {
      // The API's `adresse` includes the postal code + city; keep just the street part.
      const pc = siege.code_postal;
      if (pc && siege.adresse.includes(pc)) {
        return siege.adresse.split(pc)[0].trim().replace(/,\s*$/, '') || siege.adresse;
      }
      return siege.adresse;
    }
    const street = [siege.numero_voie, siege.type_voie, siege.libelle_voie]
      .filter(Boolean)
      .join(' ')
      .trim();
    return street || null;
  }
}

interface RawSiege {
  siret?: string;
  adresse?: string;
  code_postal?: string;
  libelle_commune?: string;
  numero_voie?: string;
  type_voie?: string;
  libelle_voie?: string;
}
interface RawCompany {
  siren?: string;
  nom_complet?: string;
  nom_raison_sociale?: string;
  sigle?: string;
  nature_juridique?: string;
  activite_principale?: string;
  siege?: RawSiege;
}

/** Most common INSEE catégorie-juridique codes → readable label (falls back to the raw code). */
const LEGAL_FORMS: Record<string, string> = {
  '1000': 'Entrepreneur individuel',
  '5202': 'SNC',
  '5410': 'SARL',
  '5499': 'SARL',
  '5498': 'EURL',
  '5710': 'SAS',
  '5720': 'SASU',
  '5505': 'SA',
  '5510': 'SA',
  '5515': 'SA',
  '5560': 'SA',
  '5599': 'SA',
  '6540': 'SCI',
  '9220': 'Association',
};
