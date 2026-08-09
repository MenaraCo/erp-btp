/**
 * Numérotation automatique paramétrable — moteur pur, partagé par tous les objets qui portent un
 * code (client, fournisseur, affaire, chantier, marché…). Même grammaire de jetons que la
 * numérotation des factures (§5.6) pour rester cohérent d'un bout à l'autre de l'application.
 *
 * Jetons : {YYYY} {YY} {MM} {DD} et {SEQ} ou {SEQ:n} (séquence complétée de zéros).
 * ex. « AFF-{YYYY}-{SEQ:4} » avec seq 1 → « AFF-2026-0001 ».
 *
 * Aucun code n'est saisi à la main : le motif est paramétré par la société dans Configuration,
 * et la séquence s'incrémente automatiquement.
 */

/** Les objets dont le code est numéroté automatiquement. */
export type NumberedEntity =
  | 'client'
  | 'supplier'
  | 'affaire'
  | 'chantier'
  | 'marche';

export const NUMBERED_ENTITIES: NumberedEntity[] = [
  'client',
  'supplier',
  'affaire',
  'chantier',
  'marche',
];

/** Motif par défaut + libellé lisible, appliqués à toute société sans réglage propre. */
export const NUMBERING_DEFAULTS: Record<NumberedEntity, { label: string; pattern: string }> = {
  client: { label: 'Client', pattern: 'CLI-{YYYY}-{SEQ:4}' },
  supplier: { label: 'Fournisseur', pattern: 'FOU-{YYYY}-{SEQ:4}' },
  affaire: { label: 'Affaire', pattern: 'AFF-{YYYY}-{SEQ:4}' },
  chantier: { label: 'Chantier', pattern: 'CH-{YYYY}-{SEQ:4}' },
  marche: { label: 'Marché', pattern: 'MAR-{YYYY}-{SEQ:4}' },
};

const SEQ_TOKEN = /\{SEQ(?::(\d+))?\}/;

/** Un motif sans jeton de séquence produirait le même code à l'infini : on l'interdit. */
export function patternHasSequence(pattern: string): boolean {
  return SEQ_TOKEN.test(pattern);
}

export function formatCode(pattern: string, seq: number, date: Date = new Date()): string {
  const yyyy = date.getFullYear().toString();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return pattern
    .replace(/\{YYYY\}/g, yyyy)
    .replace(/\{YY\}/g, yyyy.slice(-2))
    .replace(/\{MM\}/g, mm)
    .replace(/\{DD\}/g, dd)
    .replace(/\{SEQ:(\d+)\}/g, (_m, n: string) => String(seq).padStart(Number(n), '0'))
    .replace(/\{SEQ\}/g, String(seq));
}
