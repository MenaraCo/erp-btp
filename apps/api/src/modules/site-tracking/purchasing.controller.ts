import {
  BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Res,
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

/** Fichier téléversé (sous-ensemble de Express.Multer.File — évite la dépendance de types). */
interface FichierTeleverse {
  buffer: Buffer;
  originalname: string;
  mimetype?: string;
  size: number;
}
import { RequiresCapability } from '../../core/entitlements/requires-capability.decorator';
import { RequiresPermission } from '../../core/rbac/requires-permission.decorator';
import { OrderLineInput, PurchasingService } from './purchasing.service';
import { ApprovisionnementService } from './approvisionnement.service';
import { AchatsRegistreService, FiltreRegistre } from './achats-registre.service';
import { ValidationAchatsService } from './validation-achats.service';
import { LigneSaisie, RapprochementService } from './rapprochement.service';
import { CommandePdfService } from './commande-pdf.service';
import { DocumentsAchatsService, TypeDocument } from './documents-achats.service';

const NATURES = ['labor', 'material', 'equipment', 'subcontract', 'site_overhead'];

/** Traduit les paramètres d'URL du registre en filtre — un seul endroit qui connaît leurs noms. */
function filtreDepuis(query: Record<string, string>): FiltreRegistre {
  return {
    q: query.q ?? null,
    chantierId: query.chantier ?? null,
    supplierId: query.fournisseur ?? null,
    statut: query.statut ?? null,
    du: query.du ?? null,
    au: query.au ?? null,
    montantMin: query.min ?? null,
    montantMax: query.max ?? null,
    page: query.page ? Number(query.page) : 1,
    parPage: query.parPage ? Number(query.parPage) : undefined,
  };
}

@Controller()
export class PurchasingController {
  constructor(
    private readonly purchasing: PurchasingService,
    private readonly appro: ApprovisionnementService,
    private readonly registre: AchatsRegistreService,
    private readonly validation: ValidationAchatsService,
    private readonly rapprochement: RapprochementService,
    private readonly pdf: CommandePdfService,
    private readonly documents: DocumentsAchatsService,
  ) {}

  // --- Bons de livraison et factures reçus ---

  /** Dépose un justificatif sur la commande et tente d'en lire les quantités. */
  @Post('purchase-orders/:orderId/documents')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.write')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }))
  importerDocument(
    @Param('orderId') orderId: string,
    @UploadedFile() file: FichierTeleverse,
    @Query('type') type?: string,
  ) {
    if (!file?.buffer) throw new BadRequestException('Fichier manquant.');
    const attendu: TypeDocument = type === 'invoice' ? 'invoice' : type === 'autre' ? 'autre' : 'delivery';
    return this.documents.importer(orderId, file, attendu);
  }

  @Get('purchase-orders/:orderId/documents')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.read')
  listeDocuments(@Param('orderId') orderId: string) {
    return this.documents.liste(orderId);
  }

  /** Relit un document déjà déposé (après correction des codes, par exemple). */
  @Post('purchase-documents/:documentId/relire')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.write')
  relireDocument(@Param('documentId') documentId: string) {
    return this.documents.relire(documentId);
  }

  @Get('purchase-documents/:documentId/contenu')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.read')
  async contenuDocument(@Param('documentId') documentId: string, @Res() res: Response) {
    const doc = await this.documents.contenu(documentId);
    res.set({
      'Content-Type': doc.mime,
      'Content-Disposition': `inline; filename="${doc.nom.replace(/"/g, '')}"`,
      'Content-Length': String(doc.buffer.length),
    });
    res.end(doc.buffer);
  }

  /**
   * Bon de commande en PDF — l'aperçu comme l'envoi lisent CE document.
   * Servi en `inline` : c'est ce que l'aperçu affiche à côté de la commande avant de l'envoyer.
   */
  @Get('purchase-orders/:orderId/bon-de-commande.pdf')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.read')
  async bonDeCommande(@Param('orderId') orderId: string, @Res() res: Response) {
    const buffer = await this.pdf.generate(orderId);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="bon-de-commande-${orderId}.pdf"`,
      'Content-Length': String(buffer.length),
    });
    res.end(buffer);
  }

  // --- Rapprochement commande / réception / facture ---

  /** Ce qui est commandé, reçu, facturé — et ce qu'il reste, ligne par ligne. */
  @Get('purchase-orders/:orderId/rapprochement')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.read')
  rapprochementCommande(@Param('orderId') orderId: string) {
    return this.rapprochement.tableau(orderId);
  }

  /** Réception : les quantités reçues, ligne par ligne. */
  @Post('purchase-orders/:orderId/receptions')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.write')
  receptionner(
    @Param('orderId') orderId: string,
    @Body() body: { code?: string; date?: string; lignes?: LigneSaisie[] },
  ) {
    return this.rapprochement.receptionner(orderId, {
      code: body?.code ?? null, date: body?.date ?? null, lignes: body?.lignes ?? [],
    });
  }

  /** Facture fournisseur : quantités ET prix facturés, ligne par ligne. */
  @Post('purchase-orders/:orderId/factures')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.write')
  facturer(
    @Param('orderId') orderId: string,
    @Body() body: { code?: string; date?: string; lignes?: LigneSaisie[] },
  ) {
    return this.rapprochement.facturer(orderId, {
      code: body?.code ?? '', date: body?.date ?? null, lignes: body?.lignes ?? [],
    });
  }

  // --- Circuit de validation ---

  /** Règles applicables à un chantier (les siennes, ou celles de la société à défaut). */
  @Get('chantiers/:chantierId/validation-achats')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.read')
  reglesChantier(@Param('chantierId') chantierId: string) {
    return this.validation.regles(chantierId);
  }

  /** Règles POSÉES sur un périmètre — celles qu'on modifie dans les paramètres. */
  @Get('validation-achats/regles')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.read')
  reglesPosees(@Query('chantier') chantierId?: string) {
    return this.validation.toutesLesRegles(chantierId ?? null);
  }

  @Post('validation-achats/regles')
  @RequiresCapability('purchasing')
  @RequiresPermission('rbac.role.manage')
  ajouterRegle(
    @Body() body: { chantierId?: string | null; montantMin?: string | number; validatorId?: string },
  ) {
    return this.validation.ajouterRegle({
      chantierId: body?.chantierId ?? null,
      montantMin: body?.montantMin ?? 0,
      validatorId: body?.validatorId ?? '',
    });
  }

  @Delete('validation-achats/regles/:id')
  @RequiresCapability('purchasing')
  @RequiresPermission('rbac.role.manage')
  supprimerRegle(@Param('id') id: string) {
    return this.validation.supprimerRegle(id);
  }

  /** Envoi d'une commande : direct sous les seuils, sinon mise en attente de validation. */
  @Post('purchase-orders/:orderId/submit')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.write')
  soumettre(@Param('orderId') orderId: string) {
    return this.validation.soumettre(orderId);
  }

  @Post('purchase-orders/:orderId/approve')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.read')
  approuver(@Param('orderId') orderId: string, @Body() body: { motif?: string }) {
    return this.validation.decider(orderId, 'approved', body?.motif ?? null);
  }

  @Post('purchase-orders/:orderId/reject')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.read')
  refuser(@Param('orderId') orderId: string, @Body() body: { motif?: string }) {
    return this.validation.decider(orderId, 'rejected', body?.motif ?? null);
  }

  /** Où en est la validation : qui doit signer, qui a signé, et puis-je signer ? */
  @Get('purchase-orders/:orderId/approval')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.read')
  etatValidation(@Param('orderId') orderId: string) {
    return this.validation.etat(orderId);
  }

  // --- Registre d'entreprise : retrouver une pièce, tous chantiers confondus ---

  @Get('achats/commandes')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.read')
  registreCommandes(@Query() query: Record<string, string>) {
    return this.registre.commandes(filtreDepuis(query));
  }

  @Get('achats/receptions')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.read')
  registreReceptions(@Query() query: Record<string, string>) {
    return this.registre.receptions(filtreDepuis(query));
  }

  @Get('achats/factures')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.read')
  registreFactures(@Query() query: Record<string, string>) {
    return this.registre.factures(filtreDepuis(query));
  }

  /** Fiche d'une commande : en-tête, lignes, réceptions, factures. */
  @Get('purchase-orders/:orderId')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.read')
  order(@Param('orderId') orderId: string) {
    return this.purchasing.getOrder(orderId);
  }

  // DDP
  @Post('chantiers/:chantierId/purchase-requests')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.write')
  createRequest(@Param('chantierId') chantierId: string, @Body() body: { code?: string; supplierId?: string }) {
    return this.purchasing.createRequest(chantierId, { code: body.code, supplierId: body.supplierId });
  }

  @Post('purchase-requests/:requestId/convert')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.write')
  convert(@Param('requestId') requestId: string, @Body() body: { code?: string }) {
    return this.purchasing.convertRequest(requestId, body.code);
  }

  // BC
  @Post('chantiers/:chantierId/purchase-orders')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.write')
  createOrder(@Param('chantierId') chantierId: string, @Body() body: { code?: string; supplierId?: string }) {
    return this.purchasing.createOrder(chantierId, { code: body.code, supplierId: body.supplierId });
  }

  @Post('purchase-orders/:orderId/lines')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.write')
  addLine(@Param('orderId') orderId: string, @Body() body: OrderLineInput) {
    // Un commentaire n'a pas de nature d'achat : il n'entre dans aucun budget.
    if (body?.kind === 'comment') {
      return this.purchasing.addLine(orderId, {
        ...body, nature: 'material', quantity: 0, unitPrice: 0,
        designation: body.designation || 'Commentaire',
      });
    }
    if (!body?.nature || !NATURES.includes(body.nature) || !body?.designation) {
      throw new BadRequestException('nature (valid) and designation are required');
    }
    return this.purchasing.addLine(orderId, body);
  }

  /** Ce qu'il reste à approvisionner, ressource par ressource — la base d'une commande. */
  @Get('chantiers/:chantierId/approvisionnement')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.read')
  approvisionnement(
    @Param('chantierId') chantierId: string,
    @Query('fournisseur') supplierId?: string,
    @Query('lot') lotId?: string,
    @Query('famille') familleId?: string,
    @Query('code') codeAnalytiqueId?: string,
    @Query('nature') nature?: string,
    @Query('reste') reste?: string,
  ) {
    return this.appro.suggestions(chantierId, {
      supplierId, lotId, familleId, codeAnalytiqueId, nature,
      resteSeulement: reste === '1' || reste === 'true',
    });
  }

  /** Articles proposés dans la cellule « Code » d'une commande (facultatif, mais utile). */
  @Get('achats/ressources')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.read')
  chercherRessources(@Query('q') q?: string, @Query('chantier') chantierId?: string) {
    return this.appro.chercherRessources(chantierId ?? null, q ?? '');
  }

  /** Fournisseurs, lots et familles présents sur le chantier — pour commander par paquets. */
  @Get('chantiers/:chantierId/approvisionnement/regroupements')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.read')
  regroupements(@Param('chantierId') chantierId: string) {
    return this.appro.regroupements(chantierId);
  }

  /** Insère les ressources choisies dans la commande, en unité d'achat. */
  @Post('purchase-orders/:orderId/lines/nomenclature')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.write')
  insererDepuisNomenclature(
    @Param('orderId') orderId: string,
    @Body() body: {
      resourceIds?: string[];
      mode?: 'total' | 'avancement' | 'reste';
      filtre?: {
        supplierId?: string | null; lotId?: string | null; familleId?: string | null;
        codeAnalytiqueId?: string | null; nature?: string | null; resteSeulement?: boolean;
      };
    },
  ) {
    return this.appro.insererDepuisNomenclature(orderId, body ?? {});
  }

  /** En-tête : fournisseur, adresse et date de livraison, conditions. */
  @Patch('purchase-orders/:orderId')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.write')
  majOrder(
    @Param('orderId') orderId: string,
    @Body() body: {
      supplierId?: string | null; deliveryAddress?: string | null; deliveryDate?: string | null;
      deliveryConditions?: string | null; paymentTerms?: string | null; contact?: string | null;
      notes?: string | null;
    },
  ) {
    return this.purchasing.updateOrder(orderId, body ?? {});
  }

  @Patch('purchase-order-lines/:lineId')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.write')
  majLigne(
    @Param('lineId') lineId: string,
    @Body() body: {
      designation?: string; quantity?: string | number; unitPrice?: string | number;
      nature?: string; executionLineId?: string | null; codeAnalytiqueId?: string | null;
      refFournisseur?: string | null; uniteAchat?: string | null;
      coeffConversion?: string | number | null; codeProduit?: string | null; code?: string | null;
    },
  ) {
    if (body?.nature && !NATURES.includes(body.nature)) {
      throw new BadRequestException(`Nature inconnue : « ${body.nature} ».`);
    }
    return this.purchasing.updateLine(lineId, body ?? {});
  }

  @Delete('purchase-order-lines/:lineId')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.write')
  supprimerLigne(@Param('lineId') lineId: string) {
    return this.purchasing.removeLine(lineId);
  }

  @Get('purchase-orders/:orderId/lines')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.read')
  lines(@Param('orderId') orderId: string) {
    return this.purchasing.listLines(orderId);
  }

  /** Insertion d'articles du CATALOGUE d'entreprise (hors budget du chantier). */
  @Post('purchase-orders/:orderId/lines/bibliotheque')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.write')
  insererDepuisBibliotheque(
    @Param('orderId') orderId: string,
    @Body() body: { articles?: Array<{ resourceId: string; quantite?: string | number }> },
  ) {
    return this.appro.insererDepuisBibliotheque(orderId, body ?? {});
  }

  @Post('purchase-orders/:orderId/validate')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.write')
  validate(@Param('orderId') orderId: string) {
    return this.purchasing.validateOrder(orderId);
  }

  /**
   * Réouverture d'une commande envoyée — le droit `rbac.role.manage` sert de marqueur
   * d'administration : seul un administrateur le détient dans les rôles système.
   */
  @Post('purchase-orders/:orderId/reopen')
  @RequiresCapability('purchasing')
  @RequiresPermission('rbac.role.manage')
  reopen(@Param('orderId') orderId: string, @Body() body: { motif?: string }) {
    return this.purchasing.reopenOrder(orderId, body?.motif ?? '');
  }

  /** Expédie le bon de commande au fournisseur, PDF en pièce jointe. */
  @Post('purchase-orders/:orderId/envoyer')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.write')
  envoyerAuFournisseur(
    @Param('orderId') orderId: string,
    @Body() body: { destinataires?: string; copies?: string; sujet?: string; message?: string },
  ) {
    return this.purchasing.envoyerAuFournisseur(orderId, body ?? {});
  }

  /** Ce qui a déjà été expédié pour cette commande. */
  @Get('purchase-orders/:orderId/emails')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.read')
  emails(@Param('orderId') orderId: string) {
    return this.purchasing.historiqueEmails(orderId);
  }

  /** Journal d'une commande : validation, annulation, réouverture. */
  @Get('purchase-orders/:orderId/events')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.read')
  events(@Param('orderId') orderId: string) {
    return this.purchasing.listEvents(orderId);
  }

  @Post('purchase-orders/:orderId/cancel')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.write')
  cancel(@Param('orderId') orderId: string) {
    return this.purchasing.cancelOrder(orderId);
  }

  // BL
  @Post('purchase-orders/:orderId/delivery-notes')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.write')
  receive(@Param('orderId') orderId: string, @Body() body: { code?: string }) {
    return this.purchasing.receiveDelivery(orderId, body?.code);
  }

  // Facture fournisseur
  @Post('purchase-orders/:orderId/invoices')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.write')
  invoice(
    @Param('orderId') orderId: string,
    @Body()
    body: {
      code?: string;
      nature?: string;
      amountHt?: string | number;
      invoiceDate?: string;
      executionLineId?: string | null;
      codeAnalytiqueId?: string | null;
    },
  ) {
    if (!body?.code || !body?.nature || !NATURES.includes(body.nature) || body?.amountHt == null) {
      throw new BadRequestException('code, nature (valid) and amountHt are required');
    }
    return this.purchasing.addSupplierInvoice(orderId, {
      code: body.code,
      nature: body.nature,
      amountHt: body.amountHt,
      invoiceDate: body.invoiceDate,
      executionLineId: body.executionLineId,
      codeAnalytiqueId: body.codeAnalytiqueId,
    });
  }

  @Get('chantiers/:chantierId/purchasing-summary')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.read')
  summary(@Param('chantierId') chantierId: string) {
    return this.purchasing.summary(chantierId);
  }

  /** Chaîne des achats du chantier : demandes de prix et commandes détaillées (écran de suivi). */
  @Get('chantiers/:chantierId/purchasing-chain')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.read')
  chain(@Param('chantierId') chantierId: string) {
    return this.purchasing.listChain(chantierId);
  }
}
