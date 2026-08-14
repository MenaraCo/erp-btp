/**
 * Normalise un couple prénom / nom saisi séparément, avec repli sur un `fullName` historique.
 *
 * `full_name` reste la valeur d'AFFICHAGE de tous les écrans existants : on la recompose donc
 * toujours « prénom nom ». Quand seul `fullName` est fourni (intégrations antérieures au champ
 * séparé), on le découpe au premier espace — convention FR : prénom d'abord, nom ensuite.
 */
export function splitName(input: {
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
}): { firstName: string | null; lastName: string | null; fullName: string } {
  const first = (input.firstName ?? '').trim();
  const last = (input.lastName ?? '').trim();
  if (first || last) {
    return {
      firstName: first || null,
      lastName: last || null,
      fullName: [first, last].filter(Boolean).join(' '),
    };
  }
  const whole = (input.fullName ?? '').trim();
  if (!whole) return { firstName: null, lastName: null, fullName: '' };
  const sp = whole.indexOf(' ');
  if (sp < 0) return { firstName: whole, lastName: null, fullName: whole };
  return {
    firstName: whole.slice(0, sp),
    lastName: whole.slice(sp + 1).trim() || null,
    fullName: whole,
  };
}
