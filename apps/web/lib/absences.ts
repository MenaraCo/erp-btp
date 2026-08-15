/**
 * Motifs d'absence — libellés et couleurs partagés par tous les écrans.
 *
 * Les couleurs sont volontairement sourdes : une absence n'est pas une alerte, elle doit se
 * distinguer d'un chantier sans lui voler l'attention. Le rouge reste aux dérives de gestion.
 */
export const MOTIFS_ABSENCE = [
  { code: 'conges', label: 'Congés payés', couleur: '#0891b2' },
  { code: 'rtt', label: 'RTT', couleur: '#0d9488' },
  { code: 'maladie', label: 'Arrêt maladie', couleur: '#7c3aed' },
  { code: 'accident', label: 'Accident du travail', couleur: '#9d174d' },
  { code: 'intemperie', label: 'Intempéries', couleur: '#475569' },
  { code: 'formation', label: 'Formation', couleur: '#4d7c0f' },
  { code: 'ferie', label: 'Jour férié', couleur: '#78716c' },
  { code: 'sans_solde', label: 'Congé sans solde', couleur: '#a16207' },
  { code: 'autre', label: 'Autre absence', couleur: '#57534e' },
] as const;

export type MotifAbsence = (typeof MOTIFS_ABSENCE)[number]['code'];

export function libelleAbsence(code: string): string {
  return MOTIFS_ABSENCE.find((m) => m.code === code)?.label ?? code;
}

export function couleurAbsence(code: string): string {
  return MOTIFS_ABSENCE.find((m) => m.code === code)?.couleur ?? '#57534e';
}
