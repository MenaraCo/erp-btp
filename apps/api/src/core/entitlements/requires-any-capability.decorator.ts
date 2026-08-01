import { SetMetadata } from '@nestjs/common';

export const REQUIRES_ANY_CAPABILITY = 'requiresAnyCapability';

/**
 * Variante « OU » de @RequiresCapability : l'accès est ouvert dès qu'AU MOINS UNE des
 * capacités listées est active pour le tenant et détenue par l'utilisateur.
 *
 * Utile pour une fonction charnière entre deux modules — l'acceptation de commande n'a de
 * sens que si l'on suit des chantiers OU que l'on facture, indifféremment. On teste toujours
 * des capacités, jamais un nom de module ou de pack (cahier des charges §3.1).
 */
export const RequiresAnyCapability = (...capabilities: string[]) =>
  SetMetadata(REQUIRES_ANY_CAPABILITY, capabilities);
