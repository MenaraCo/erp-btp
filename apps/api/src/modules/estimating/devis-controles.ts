/**
 * Contrôles de cohérence d'un devis — le « carnet de santé » de l'étude.
 *
 * Un devis se construit sur des jours, à plusieurs, en copiant des ouvrages : les oublis sont la
 * règle, pas l'exception. Une ressource sans code analytique fausse tout le suivi de chantier ; un
 * prix à zéro se remarque une fois le devis envoyé. Ces contrôles tournent en continu et disent ce
 * qui manque, ligne par ligne.
 *
 * Fonction PURE : aucune requête, aucun accès au temps. Les règles se testent une par une.
 */

export type ControleNiveau = 'bloquant' | 'avertissement' | 'info';

export interface ControleLine {
  id: string;
  parentLineId: string | null;
  type: string;
  numero?: string | null;
  /** Numéro du parent : une ressource n'en a pas, on la situe donc par l'ouvrage qui la porte. */
  parentNumero?: string | null;
  code?: string | null;
  designation: string;
  unit?: string | null;
  quantity?: string | null;
  pu?: string | null;
  /** false = ligne de frais : son coût est réparti, elle n'a pas de prix de vente propre. */
  vendable?: boolean;
  codeAnalytique?: string | null;
  /** Ouvrage venant de la bibliothèque : son sous-détail peut être vide sans que ce soit une erreur. */
  sourceOuvrageId?: string | null;
  /** Prix de vente forcé : la ligne se vend à ce prix, sans passer par un déboursé. */
  puVenteForce?: boolean;
}

export interface ControleContexte {
  lines: ControleLine[];
  /** Feuille de vente configurée (coefficients enregistrés) ? */
  coefficientsConfigures: boolean;
  /** Marge nette du devis, telle que calculée par la feuille de vente (null = non calculable). */
  margeNette?: number | null;
  /** Total de vente HT. */
  totalPvHt?: number | null;
  /** L'affaire porte-t-elle un client ? Indispensable pour envoyer le devis. */
  clientRenseigne: boolean;
}

export interface Controle {
  /** Identifiant stable de la règle, pour pouvoir la citer ou la filtrer. */
  code: string;
  niveau: ControleNiveau;
  message: string;
  /** Ligne concernée, quand le contrôle en vise une. */
  lineId?: string;
  /** Repère lisible : « 1.2.1 F/P de peinture ». */
  ligne?: string;
}

const isTitre = (l: ControleLine) => l.type === 'titre' || l.type === 'sous_titre';
const isChiffrable = (l: ControleLine) => l.type === 'ouvrage' || l.type === 'ressource';
const nombre = (v: string | null | undefined) => (v == null || v === '' ? null : Number(v));

/**
 * Repère affiché à l'utilisateur. Les ressources ne sont pas numérotées (convention du montage) :
 * on les situe alors par l'ouvrage ou le titre qui les porte — « 1.1 › Peinture ».
 */
function repere(l: ControleLine): string {
  const des = (l.designation ?? '').trim() || '(sans désignation)';
  const num = (l.numero ?? '').trim();
  if (num) return `${num} ${des}`;
  const parent = (l.parentNumero ?? '').trim();
  return parent ? `${parent} › ${des}` : des;
}

export function controlerDevis(ctx: ControleContexte): Controle[] {
  const out: Controle[] = [];
  const { lines } = ctx;
  const enfantsDe = new Map<string | null, ControleLine[]>();
  for (const l of lines) {
    const k = l.parentLineId ?? null;
    const arr = enfantsDe.get(k);
    if (arr) arr.push(l);
    else enfantsDe.set(k, [l]);
  }
  const add = (code: string, niveau: ControleNiveau, message: string, l?: ControleLine) =>
    out.push({ code, niveau, message, lineId: l?.id, ligne: l ? repere(l) : undefined });

  // ── Devis vide : rien à chiffrer, rien à envoyer.
  if (!lines.some((l) => isChiffrable(l))) {
    add('devis_vide', 'bloquant', 'Le devis ne contient aucune ligne chiffrable.');
  }

  for (const l of lines) {
    const enfants = enfantsDe.get(l.id) ?? [];

    if (!(l.designation ?? '').trim()) {
      add('designation_manquante', 'bloquant', 'Ligne sans désignation.', l);
    }

    if (isTitre(l)) {
      if (enfants.length === 0) {
        add('titre_vide', 'info', 'Ce titre ne contient aucune ligne.', l);
      }
      continue;
    }
    if (!isChiffrable(l)) continue;

    // ── Unité : sans elle, ni le client ni le chantier ne savent ce qu'on compte.
    if (!(l.unit ?? '').trim()) {
      add('unite_manquante', 'avertissement', 'Unité non renseignée.', l);
    }

    // ── Quantité.
    const qty = nombre(l.quantity);
    if (qty == null) {
      add('quantite_manquante', 'avertissement', 'Quantité non renseignée.', l);
    } else if (qty === 0) {
      add('quantite_nulle', 'avertissement', 'Quantité à zéro : la ligne ne compte pour rien.', l);
    } else if (qty < 0) {
      add('quantite_negative', 'bloquant', 'Quantité négative.', l);
    }

    if (l.type === 'ressource') {
      // ── Prix unitaire de déboursé.
      const pu = nombre(l.pu);
      if (pu == null) {
        add('pu_manquant', 'avertissement', 'Prix unitaire vide.', l);
      } else if (pu === 0) {
        add('pu_nul', 'avertissement', 'Prix unitaire à zéro.', l);
      } else if (pu < 0) {
        add('pu_negatif', 'bloquant', 'Prix unitaire négatif.', l);
      }

      // ── Code analytique : sans lui, la ressource part en « 999 — À ventiler » au chantier.
      if (!(l.codeAnalytique ?? '').trim()) {
        add(
          'code_analytique_manquant',
          'avertissement',
          'Aucun code analytique : la ressource arrivera « À ventiler » au chantier.',
          l,
        );
      }
    }

    // ── Ouvrage sans sous-détail ET sans origine bibliothèque : son déboursé est nul.
    // Sauf s'il se vend à un PRIX FORCÉ : c'est le cas des bordereaux d'appel d'offre repris tels
    // quels, où le prix est donné et le sous-détail n'existe pas. Le signaler noierait le panneau.
    if (l.type === 'ouvrage' && enfants.length === 0 && !l.sourceOuvrageId && !l.puVenteForce) {
      add('ouvrage_sans_sous_detail', 'avertissement', 'Ouvrage sans sous-détail : déboursé nul.', l);
    }
  }

  // ── Feuille de vente.
  if (!ctx.coefficientsConfigures) {
    add(
      'coefficients_absents',
      'bloquant',
      'Les coefficients de la feuille de vente ne sont pas enregistrés : le devis se vend à son déboursé.',
    );
  } else if (ctx.margeNette != null && ctx.margeNette < 0) {
    add('marge_negative', 'bloquant', 'La marge nette est négative : le devis se vend à perte.');
  } else if (ctx.margeNette === 0) {
    add('marge_nulle', 'avertissement', 'La marge nette est nulle.');
  }

  if (ctx.totalPvHt != null && ctx.totalPvHt === 0) {
    add('total_nul', 'bloquant', 'Le total de vente est à zéro.');
  }

  // ── Destinataire.
  if (!ctx.clientRenseigne) {
    add('client_absent', 'avertissement', 'Aucun client sur l’affaire : le devis ne peut pas être adressé.');
  }

  return out;
}

/** Compte par niveau, pour la pastille de l'écran. */
export function compterControles(controles: Controle[]): Record<ControleNiveau, number> {
  return controles.reduce(
    (acc, c) => ({ ...acc, [c.niveau]: acc[c.niveau] + 1 }),
    { bloquant: 0, avertissement: 0, info: 0 } as Record<ControleNiveau, number>,
  );
}
