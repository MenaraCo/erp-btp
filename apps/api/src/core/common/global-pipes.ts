import { INestApplication, ValidationPipe } from '@nestjs/common';

/**
 * Validation des entrées, appliquée à TOUTE l'application.
 *
 * Le même réglage sert à l'application réelle (main.ts) et aux applications de test : une règle
 * qui ne vaudrait qu'en production ne serait vérifiée par personne.
 *
 * `whitelist` retire les champs non déclarés au lieu de les refuser : la reprise est progressive.
 * Les corps de requête typés par une simple interface passent tels quels — seuls les DTO en
 * CLASSE, porteurs de décorateurs, sont réellement validés. On peut donc convertir endpoint par
 * endpoint sans rien casser.
 */
export function applyGlobalPipes(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      // Message parlant plutôt qu'un « Bad Request » nu.
      validationError: { target: false, value: false },
    }),
  );
}
