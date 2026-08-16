import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { createTransport, type Transporter } from 'nodemailer';
import { TenantContext } from '../tenancy/tenant-context';
import { runInTenant } from '../tenancy/tenant-transaction';

export interface MessageSortant {
  destinataires: string;
  copies?: string | null;
  sujet: string;
  corps: string;
  piecesJointes?: Array<{ filename: string; content: Buffer; contentType?: string }>;
  /** Ce à quoi le message se rapporte, pour le retrouver depuis la pièce concernée. */
  objetType?: string | null;
  objetId?: string | null;
}

export interface ResultatEnvoi {
  id: string;
  statut: 'sent' | 'pending' | 'failed';
  message: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Envoi d'e-mails, avec journal.
 *
 * Deux principes tiennent cette classe :
 *
 * — On n'invente jamais un envoi. Sans serveur d'envoi configuré, le message est enregistré en
 *   ATTENTE et l'écran le dit clairement. Afficher « envoyé » sans expédier serait le pire des
 *   mensonges : on croirait le fournisseur prévenu alors qu'il n'a rien reçu.
 * — Tout message part avec sa trace. Six mois plus tard, la question n'est pas « a-t-on cliqué »
 *   mais « qu'a-t-on envoyé, à qui, et quand ».
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private transporteur: Transporter | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  /** La messagerie est-elle configurée ? L'écran s'en sert pour prévenir AVANT le clic. */
  estConfiguree(): boolean {
    return Boolean(process.env.SMTP_HOST && process.env.MAIL_FROM);
  }

  async envoyer(message: MessageSortant): Promise<ResultatEnvoi> {
    const tenantId = this.context.requireTenantId();
    const destinataires = decouper(message.destinataires);
    // Une adresse fautive est une erreur de SAISIE : elle se corrige, elle ne « plante » pas.
    if (destinataires.length === 0) {
      throw new BadRequestException('Aucun destinataire.');
    }
    const invalides = destinataires.filter((a) => !EMAIL_RE.test(a));
    if (invalides.length > 0) {
      throw new BadRequestException(`Adresse invalide : ${invalides.join(', ')}`);
    }
    const copies = decouper(message.copies ?? '');

    return runInTenant(this.dataSource, tenantId, async (em) => {
      const id = await this.journaliser(em, tenantId, message, destinataires, copies);

      if (!this.estConfiguree()) {
        // Pas de serveur : le message reste en attente, et on le DIT.
        return {
          id,
          statut: 'pending' as const,
          message: 'Message enregistré, mais aucune messagerie n’est configurée : il n’est pas parti.',
        };
      }

      try {
        await this.transport().sendMail({
          from: process.env.MAIL_FROM,
          to: destinataires,
          cc: copies.length > 0 ? copies : undefined,
          subject: message.sujet,
          text: message.corps,
          attachments: message.piecesJointes,
        });
        await em.query(
          `UPDATE email_message SET statut = 'sent', expedie_le = now() WHERE id = $1`, [id],
        );
        return { id, statut: 'sent' as const, message: `Envoyé à ${destinataires.join(', ')}.` };
      } catch (e) {
        const erreur = e instanceof Error ? e.message : 'Envoi impossible';
        this.logger.error(`Envoi e-mail échoué : ${erreur}`);
        await em.query(
          `UPDATE email_message SET statut = 'failed', erreur = $2 WHERE id = $1`, [id, erreur],
        );
        return { id, statut: 'failed' as const, message: `Envoi impossible : ${erreur}` };
      }
    });
  }

  /** Messages liés à une pièce (une commande, par exemple), du plus récent au plus ancien. */
  historique(objetType: string, objetId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      em.query(
        `SELECT e.id, e.destinataires, e.copies, e.sujet, e.piece_jointe, e.statut, e.erreur,
                e.expedie_le, e.created_at,
                trim(coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,'')) AS auteur,
                u.email AS auteur_email
           FROM email_message e
           LEFT JOIN user_account u ON u.id = e.auteur_id
          WHERE e.objet_type = $1 AND e.objet_id = $2
          ORDER BY e.created_at DESC`,
        [objetType, objetId],
      ),
    );
  }

  private journaliser(
    em: EntityManager,
    tenantId: string,
    message: MessageSortant,
    destinataires: string[],
    copies: string[],
  ): Promise<string> {
    return em
      .query(
        `INSERT INTO email_message
           (tenant_id, destinataires, copies, sujet, corps, piece_jointe, objet_type, objet_id, auteur_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [
          tenantId, destinataires.join(', '), copies.join(', ') || null,
          message.sujet, message.corps,
          message.piecesJointes?.map((p) => p.filename).join(', ') || null,
          message.objetType ?? null, message.objetId ?? null,
          this.context.getUserId() ?? null,
        ],
      )
      .then((rows: Array<{ id: string }>) => rows[0].id);
  }

  private transport(): Transporter {
    if (!this.transporteur) {
      const port = Number(process.env.SMTP_PORT ?? 587);
      this.transporteur = createTransport({
        host: process.env.SMTP_HOST,
        port,
        // 465 est le port TLS implicite ; ailleurs, STARTTLS suffit.
        secure: port === 465,
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
          : undefined,
      });
    }
    return this.transporteur;
  }
}

/** Une saisie humaine sépare les adresses par virgule, point-virgule ou espace. */
function decouper(valeur: string): string[] {
  return (valeur ?? '')
    .split(/[,;\s]+/)
    .map((a) => a.trim())
    .filter(Boolean);
}
