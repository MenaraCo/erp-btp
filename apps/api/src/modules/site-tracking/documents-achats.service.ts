import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { dirname, join } from 'path';
import Decimal from 'decimal.js';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';

export type TypeDocument = 'delivery' | 'invoice' | 'autre';

export interface PropositionLigne {
  orderLineId: string;
  designation: string;
  code: string | null;
  quantiteCommandee: string;
  resteAttendu: string;
  /** Quantité trouvée dans le document, ou null si la lecture n'a rien reconnu pour cette ligne. */
  quantiteLue: string | null;
  /** Prix unitaire lu, pour une facture. */
  puLu: string | null;
  /** Ce qui a permis la reconnaissance — affiché pour que l'utilisateur puisse juger. */
  indice: string | null;
}

/** Taille au-delà de laquelle un justificatif n'est plus un justificatif mais un problème. */
const TAILLE_MAX = 15 * 1024 * 1024;

/**
 * Fichier « worker » du moteur PDF, résolu depuis le paquet installé.
 *
 * Sans cette désignation explicite, le moteur va le chercher par import dynamique — ce que
 * certains environnements d'exécution refusent, et la lecture échoue alors silencieusement.
 */
function cheminDuWorker(): string {
  // require.resolve pointe sur l'entrée du paquet (…/dist/pdf-parse/cjs/index.cjs) ; le worker
  // est livré à côté, dans le même dossier de distribution.
  const entree = require.resolve('pdf-parse');
  return join(dirname(entree), 'pdf.worker.mjs');
}

/**
 * Import des bons de livraison et factures fournisseur, avec lecture automatique.
 *
 * Ce que la lecture fait : chercher, dans le texte du document, les codes et désignations des
 * lignes de la commande, puis la quantité qui les accompagne. Ce qu'elle ne fait PAS : deviner.
 * Une ligne non reconnue est laissée vide plutôt que remplie au hasard — une quantité inventée
 * dans un rapprochement coûte plus cher qu'une case à saisir.
 *
 * Les documents sans couche texte (photos, scans bruts) sont acceptés et conservés, mais annoncés
 * comme non lus : mieux vaut une saisie manuelle assumée qu'une reconnaissance imaginaire.
 */
@Injectable()
export class DocumentsAchatsService {
  private readonly logger = new Logger(DocumentsAchatsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  /** Dépose un document sur une commande et tente d'en lire le contenu. */
  async importer(
    orderId: string,
    fichier: { buffer: Buffer; originalname: string; mimetype?: string; size: number },
    type: TypeDocument,
  ) {
    const tenantId = this.context.requireTenantId();
    if (!fichier?.buffer?.length) throw new BadRequestException('Fichier manquant.');
    if (fichier.size > TAILLE_MAX) {
      throw new BadRequestException('Fichier trop lourd : 15 Mo au maximum.');
    }

    const texte = await this.lireTexte(fichier.buffer, fichier.mimetype ?? '');
    const statut = texte === null ? 'sans_texte' : 'lu';

    return runInTenant(this.dataSource, tenantId, async (em) => {
      const commande = await em.query(`SELECT id FROM purchase_order WHERE id = $1`, [orderId]);
      if (commande.length === 0) throw new NotFoundException('Commande introuvable.');

      const rows = await em.query(
        `INSERT INTO purchase_document
           (tenant_id, order_id, type, nom_fichier, mime, taille, contenu, texte_extrait,
            lecture_statut, auteur_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING id, nom_fichier, type, taille, lecture_statut, created_at`,
        [tenantId, orderId, type, fichier.originalname, fichier.mimetype ?? 'application/octet-stream',
          fichier.size, fichier.buffer, texte, statut, this.context.getUserId() ?? null],
      );
      const document = rows[0];
      const propositions = await this.proposer(em, orderId, texte, type);
      return {
        document: {
          id: document.id as string,
          nomFichier: document.nom_fichier as string,
          type: document.type as string,
          taille: Number(document.taille),
          lecture: document.lecture_statut as string,
        },
        propositions,
        message: texte === null
          ? 'Document conservé. Il n’a pas de texte lisible (scan ou photo) : saisissez les quantités.'
          : propositions.some((p) => p.quantiteLue !== null)
            ? 'Document lu : les quantités reconnues sont pré-remplies, vérifiez-les.'
            : 'Document lu, mais aucune ligne n’a pu être reconnue : saisissez les quantités.',
      };
    });
  }

  /** Documents rattachés à une commande (sans leur contenu, qui se télécharge à part). */
  liste(orderId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      em.query(
        `SELECT d.id, d.type, d.nom_fichier, d.mime, d.taille, d.lecture_statut, d.created_at,
                trim(coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,'')) AS auteur,
                u.email AS auteur_email
           FROM purchase_document d
           LEFT JOIN user_account u ON u.id = d.auteur_id
          WHERE d.order_id = $1
          ORDER BY d.created_at DESC`,
        [orderId],
      ),
    );
  }

  /** Contenu d'un document, pour l'afficher ou le télécharger. */
  contenu(documentId: string): Promise<{ nom: string; mime: string; buffer: Buffer }> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `SELECT nom_fichier, mime, contenu FROM purchase_document WHERE id = $1`, [documentId],
      );
      if (rows.length === 0) throw new NotFoundException('Document introuvable.');
      return {
        nom: rows[0].nom_fichier as string,
        mime: rows[0].mime as string,
        buffer: rows[0].contenu as Buffer,
      };
    });
  }

  /** Relit un document déjà déposé : utile après avoir corrigé les codes de la commande. */
  relire(documentId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `SELECT order_id, type, texte_extrait FROM purchase_document WHERE id = $1`, [documentId],
      );
      if (rows.length === 0) throw new NotFoundException('Document introuvable.');
      return {
        propositions: await this.proposer(
          em, rows[0].order_id as string, rows[0].texte_extrait as string | null,
          rows[0].type as TypeDocument,
        ),
      };
    });
  }

  /**
   * Rapproche le texte lu des lignes de la commande.
   *
   * Stratégie volontairement simple et vérifiable : pour chaque ligne, on cherche son CODE (le
   * plus fiable, c'est une référence), à défaut sa désignation ; puis on lit le premier nombre
   * qui suit sur la même ligne de texte. Ce qui n'est pas trouvé reste vide.
   */
  private async proposer(
    em: EntityManager,
    orderId: string,
    texte: string | null,
    type: TypeDocument,
  ): Promise<PropositionLigne[]> {
    const lignes: Array<Record<string, unknown>> = await em.query(
      `SELECT l.id, l.code, l.designation, l.quantity, l.unit_price,
              COALESCE(recu.qte, 0) AS qte_recue, COALESCE(fact.qte, 0) AS qte_facturee
         FROM purchase_order_line l
         LEFT JOIN (SELECT order_line_id, SUM(quantite_livree) AS qte
                      FROM delivery_note_line GROUP BY order_line_id) recu ON recu.order_line_id = l.id
         LEFT JOIN (SELECT order_line_id, SUM(quantite_facturee) AS qte
                      FROM supplier_invoice_line GROUP BY order_line_id) fact ON fact.order_line_id = l.id
        WHERE l.order_id = $1 AND l.kind <> 'comment'
        ORDER BY l.sort_order ASC`,
      [orderId],
    );

    const lignesTexte = (texte ?? '')
      .split(/\r?\n/)
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    return lignes.map((l) => {
      const commandee = new Decimal(String(l.quantity ?? 0));
      const deja = new Decimal(String(type === 'invoice' ? l.qte_facturee : l.qte_recue));
      const reste = Decimal.max(commandee.minus(deja), 0);

      const trouvee = texte ? this.chercherLigne(lignesTexte, l) : null;
      return {
        orderLineId: l.id as string,
        designation: l.designation as string,
        code: (l.code as string | null) ?? null,
        quantiteCommandee: commandee.toString(),
        resteAttendu: reste.toString(),
        quantiteLue: trouvee?.quantite ?? null,
        puLu: type === 'invoice' ? (trouvee?.pu ?? null) : null,
        indice: trouvee?.indice ?? null,
      };
    });
  }

  private chercherLigne(
    lignesTexte: string[],
    ligne: Record<string, unknown>,
  ): { quantite: string; pu: string | null; indice: string } | null {
    const code = String(ligne.code ?? '').trim();
    const designation = String(ligne.designation ?? '').trim();
    const aiguilles = [code, designation.slice(0, 24)].filter((a) => a.length >= 3);

    for (const aiguille of aiguilles) {
      const cible = aiguille.toLowerCase();
      const texteLigne = lignesTexte.find((t) => t.toLowerCase().includes(cible));
      if (!texteLigne) continue;

      // Nombres de la ligne, virgule décimale comprise (« 12,5 » comme « 12.5 »).
      const nombres = (texteLigne.match(/-?\d+(?:[.,]\d+)?/g) ?? [])
        .map((n) => n.replace(',', '.'))
        .filter((n) => Number.isFinite(Number(n)));
      if (nombres.length === 0) continue;

      // Le premier nombre après l'aiguille est presque toujours la quantité ; le suivant, le prix.
      const position = texteLigne.toLowerCase().indexOf(cible) + cible.length;
      const apres = (texteLigne.slice(position).match(/-?\d+(?:[.,]\d+)?/g) ?? [])
        .map((n) => n.replace(',', '.'));
      const retenus = apres.length > 0 ? apres : nombres;
      return {
        quantite: retenus[0],
        pu: retenus[1] ?? null,
        indice: `« ${texteLigne.slice(0, 90)} »`,
      };
    }
    return null;
  }

  /**
   * Texte d'un PDF. Renvoie `null` quand le document n'en contient pas — un scan, une photo —
   * plutôt que de renvoyer une chaîne vide qu'on prendrait pour une lecture réussie.
   */
  private async lireTexte(buffer: Buffer, mime: string): Promise<string | null> {
    if (!mime.includes('pdf') && buffer.subarray(0, 5).toString() !== '%PDF-') return null;
    let lecteur: { getText: () => Promise<{ text?: string }>; destroy: () => Promise<void> } | null = null;
    try {
      const { PDFParse } = await import('pdf-parse');
      // Le moteur PDF va chercher son « worker » par import dynamique, ce que certains
      // environnements d'exécution refusent. On lui désigne le fichier une bonne fois : la
      // lecture se fait alors dans le processus, sans import à la volée.
      // Désignation explicite du worker quand il est trouvable : la lecture s'en trouve plus
      // robuste dans les environnements restreints. Son absence n'est pas bloquante.
      try { PDFParse.setWorker(cheminDuWorker()); } catch { /* le moteur se débrouillera seul */ }
      lecteur = new PDFParse({ data: new Uint8Array(buffer) });
      const resultat = await lecteur.getText();
      const texte = (resultat.text ?? '').trim();
      // Vingt caractères : en deçà, c'est du bruit de scan, pas un document lisible.
      return texte.length >= 20 ? texte : null;
    } catch (e) {
      this.logger.warn(`Lecture PDF impossible : ${e instanceof Error ? e.message : e}`);
      return null;
    } finally {
      await lecteur?.destroy().catch(() => undefined);
    }
  }
}
