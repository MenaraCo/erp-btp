import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import Decimal from 'decimal.js';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import { NumberingService } from '../../core/numbering/numbering.service';

export type ContractType =
  | 'cdi' | 'cdd' | 'alternance' | 'stage' | 'apprentissage' | 'interimaire';

/** Contrats à durée déterminée : leur fin doit être connue, c'est ce qui les définit. */
const CONTRATS_A_TERME: ContractType[] = ['cdd', 'alternance', 'stage', 'apprentissage'];

export interface EmployeeInput {
  firstName?: string | null;
  lastName?: string;
  jobTitle?: string | null;
  hourlyCost?: string | number;
  contractType?: ContractType;
  /** Agence d'intérim, pour un intérimaire. */
  agency?: string | null;
  /** Poste analytique par défaut : c'est là que ses heures s'imputeront. */
  codeAnalytiqueId?: string | null;
  active?: boolean;
  /* — Administratif : ce qu'on cherche en ouvrant un dossier — */
  dateEntree?: string | null;
  dateSortie?: string | null;
  dateNaissance?: string | null;
  numeroSecu?: string | null;
  telephone?: string | null;
  email?: string | null;
  adresse?: string | null;
  codePostal?: string | null;
  ville?: string | null;
  qualification?: string | null;
  /** Dernière visite médicale : périmée, elle interdit le chantier. */
  dateVisiteMedicale?: string | null;
  /** Fin d'un CDD, d'un stage, d'une alternance ou d'un apprentissage. */
  dateFinContrat?: string | null;
  commentaire?: string | null;
}

/** Champs administratifs : même traitement partout, donc une seule liste. */
const CHAMPS_ADMIN = [
  ['dateEntree', 'date_entree'],
  ['dateSortie', 'date_sortie'],
  ['dateNaissance', 'date_naissance'],
  ['numeroSecu', 'numero_secu'],
  ['telephone', 'telephone'],
  ['email', 'email'],
  ['adresse', 'adresse'],
  ['codePostal', 'code_postal'],
  ['ville', 'ville'],
  ['qualification', 'qualification'],
  ['dateVisiteMedicale', 'date_visite_medicale'],
  ['dateFinContrat', 'date_fin_contrat'],
  ['commentaire', 'commentaire'],
] as const;

export interface EmployeeRow {
  id: string;
  code: string;
  firstName: string | null;
  lastName: string;
  fullName: string;
  jobTitle: string | null;
  hourlyCost: string;
  contractType: ContractType;
  agency: string | null;
  codeAnalytiqueId: string | null;
  codeAnalytique: string | null;
  active: boolean;
  dateEntree: string | null;
  dateSortie: string | null;
  dateNaissance: string | null;
  numeroSecu: string | null;
  telephone: string | null;
  email: string | null;
  adresse: string | null;
  codePostal: string | null;
  ville: string | null;
  qualification: string | null;
  dateVisiteMedicale: string | null;
  dateFinContrat: string | null;
  commentaire: string | null;
}

const CONTRACTS: ContractType[] = [
  'cdi', 'cdd', 'alternance', 'stage', 'apprentissage', 'interimaire',
];

/**
 * Fichier des salariés du suivi de chantiers.
 *
 * Le pointage s'appuyait sur un texte libre : deux orthographes créaient deux personnes, et aucun
 * coût horaire n'était mémorisé. La fiche porte l'identité, la qualification et le COÛT HORAIRE
 * DE REVIENT (ce que l'heure coûte à l'entreprise, pas le brut) — repris à la saisie des heures.
 *
 * Le code est attribué par le moteur de numérotation, comme les clients ou les chantiers : rien
 * n'est saisi en dur, tout est paramétrable dans Configuration.
 */
@Injectable()
export class EmployeeService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
    private readonly numbering: NumberingService,
  ) {}

  list(includeInactive = false): Promise<EmployeeRow[]> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `SELECT e.id, e.code, e.first_name, e.last_name, e.job_title, e.hourly_cost,
                e.contract_type, e.agency, e.code_analytique_id, e.active,
                e.date_entree::text, e.date_sortie::text, e.date_naissance::text,
                e.numero_secu, e.telephone, e.email, e.adresse, e.code_postal, e.ville,
                e.qualification, e.date_visite_medicale::text, e.date_fin_contrat::text,
                e.commentaire,
                a.code AS code_analytique
           FROM employee e
           LEFT JOIN analytical_code a ON a.id = e.code_analytique_id
          WHERE e.deleted_at IS NULL ${includeInactive ? '' : 'AND e.active = true'}
          ORDER BY e.last_name, e.first_name NULLS FIRST`,
      );
      return rows.map(toRow);
    });
  }

  create(input: EmployeeInput): Promise<EmployeeRow> {
    const tenantId = this.context.requireTenantId();
    const lastName = (input.lastName ?? '').trim();
    if (!lastName) throw new BadRequestException('Le nom du salarié est requis.');
    const hourlyCost = check(input.hourlyCost);
    const contractType = checkContract(input.contractType);
    checkFinContrat(contractType, input.dateFinContrat);

    return runInTenant(this.dataSource, tenantId, async (em) => {
      const code = await this.numbering.next(em, 'employee');
      const rows = await em.query(
        `INSERT INTO employee
           (tenant_id, code, first_name, last_name, job_title, hourly_cost, contract_type, agency,
            code_analytique_id, active,
            date_entree, date_sortie, date_naissance, numero_secu, telephone, email,
            adresse, code_postal, ville, qualification, date_visite_medicale,
            date_fin_contrat, commentaire)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                 $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
         RETURNING id, code, first_name, last_name, job_title, hourly_cost, contract_type, agency,
                   code_analytique_id, active,
                   date_entree::text, date_sortie::text, date_naissance::text, numero_secu,
                   telephone, email, adresse, code_postal, ville, qualification,
                   date_visite_medicale::text, date_fin_contrat::text, commentaire`,
        [
          tenantId,
          code,
          (input.firstName ?? '').trim() || null,
          lastName,
          (input.jobTitle ?? '').trim() || null,
          hourlyCost,
          contractType,
          (input.agency ?? '').trim() || null,
          input.codeAnalytiqueId ?? null,
          input.active ?? true,
          ...CHAMPS_ADMIN.map(([cle]) => texte(input[cle])),
        ],
      );
      return toRow(rows[0]);
    });
  }

  update(id: string, input: EmployeeInput): Promise<EmployeeRow> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const current = (
        await em.query(`SELECT * FROM employee WHERE id = $1 AND deleted_at IS NULL`, [id])
      )[0];
      if (!current) throw new NotFoundException('Salarié introuvable');

      const lastName =
        input.lastName === undefined ? current.last_name : (input.lastName ?? '').trim();
      if (!lastName) throw new BadRequestException('Le nom du salarié est requis.');

      const contractType = input.contractType === undefined
        ? (current.contract_type as ContractType) : checkContract(input.contractType);
      checkFinContrat(
        contractType,
        input.dateFinContrat === undefined ? current.date_fin_contrat : input.dateFinContrat,
      );

      const rows = await em.query(
        `UPDATE employee
            SET first_name = $2, last_name = $3, job_title = $4, hourly_cost = $5,
                contract_type = $6, agency = $7, code_analytique_id = $8, active = $9,
                date_entree = $10, date_sortie = $11, date_naissance = $12, numero_secu = $13,
                telephone = $14, email = $15, adresse = $16, code_postal = $17, ville = $18,
                qualification = $19, date_visite_medicale = $20, date_fin_contrat = $21,
                commentaire = $22,
                updated_at = now()
          WHERE id = $1
          RETURNING id, code, first_name, last_name, job_title, hourly_cost, contract_type, agency,
                    code_analytique_id, active,
                    date_entree::text, date_sortie::text, date_naissance::text, numero_secu,
                    telephone, email, adresse, code_postal, ville, qualification,
                    date_visite_medicale::text, date_fin_contrat::text, commentaire`,
        [
          id,
          input.firstName === undefined ? current.first_name : (input.firstName ?? '').trim() || null,
          lastName,
          input.jobTitle === undefined ? current.job_title : (input.jobTitle ?? '').trim() || null,
          input.hourlyCost === undefined ? current.hourly_cost : check(input.hourlyCost),
          contractType,
          input.agency === undefined ? current.agency : (input.agency ?? '').trim() || null,
          input.codeAnalytiqueId === undefined ? current.code_analytique_id : input.codeAnalytiqueId,
          input.active === undefined ? current.active : input.active,
          // Un champ absent du corps de la requête n'est pas un champ vidé : on garde l'existant.
          ...CHAMPS_ADMIN.map(([cle, colonne]) =>
            input[cle] === undefined ? current[colonne] : texte(input[cle])),
        ],
      );
      return toRow(rows[0]);
    });
  }

  /**
   * Retire un salarié. Suppression LOGIQUE dès qu'il a pointé : ses heures composent le réalisé
   * du chantier, les effacer fausserait un résultat déjà publié. On le rend simplement inactif.
   */
  async remove(id: string): Promise<{ deleted: boolean; deactivated: boolean }> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const found = await em.query(
        `SELECT id FROM employee WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      );
      if (found.length === 0) throw new NotFoundException('Salarié introuvable');

      const [{ n }] = await em.query(
        `SELECT count(*)::int AS n FROM timesheet WHERE employee_id = $1`,
        [id],
      );
      if (Number(n) > 0) {
        await em.query(
          `UPDATE employee SET active = false, updated_at = now() WHERE id = $1`,
          [id],
        );
        return { deleted: false, deactivated: true };
      }
      await em.query(`UPDATE employee SET deleted_at = now() WHERE id = $1`, [id]);
      return { deleted: true, deactivated: false };
    });
  }
}

/** Chaîne nettoyée, ou null : une case vide ne vaut pas une chaîne vide en base. */
function texte(v: string | null | undefined): string | null {
  const s = (v ?? '').trim();
  return s === '' ? null : s;
}

function check(v: string | number | undefined): string {
  const d = new Decimal(v ?? 0);
  if (d.isNegative()) throw new BadRequestException('Le coût horaire ne peut pas être négatif.');
  return d.toDecimalPlaces(4).toFixed(4);
}

function checkContract(v: ContractType | undefined): ContractType {
  if (v === undefined) return 'cdi';
  if (!CONTRACTS.includes(v)) {
    throw new BadRequestException(
      `Type de contrat inconnu (${CONTRACTS.join(', ')}).`,
    );
  }
  return v;
}

/**
 * Un contrat à terme sans date de fin est un contrat qu'on oublie : personne ne sera prévenu que
 * la mission s'arrête vendredi. On l'exige donc à la saisie, pas au moment du renouvellement raté.
 */
function checkFinContrat(type: ContractType, fin: string | null | undefined): void {
  if (CONTRATS_A_TERME.includes(type) && !fin) {
    throw new BadRequestException(
      'Un contrat à durée déterminée doit porter sa date de fin.',
    );
  }
}

type LigneBrute = Record<string, string | boolean | null | undefined>;

function chaine(v: string | boolean | null | undefined): string | null {
  return v == null ? null : String(v);
}

function toRow(r: LigneBrute): EmployeeRow {
  return {
    id: String(r.id),
    code: String(r.code),
    firstName: chaine(r.first_name),
    lastName: String(r.last_name),
    fullName: [r.first_name, r.last_name].filter(Boolean).join(' '),
    jobTitle: chaine(r.job_title),
    hourlyCost: String(r.hourly_cost),
    contractType: r.contract_type as ContractType,
    agency: chaine(r.agency),
    codeAnalytiqueId: chaine(r.code_analytique_id),
    codeAnalytique: chaine(r.code_analytique),
    active: Boolean(r.active),
    dateEntree: chaine(r.date_entree),
    dateSortie: chaine(r.date_sortie),
    dateNaissance: chaine(r.date_naissance),
    numeroSecu: chaine(r.numero_secu),
    telephone: chaine(r.telephone),
    email: chaine(r.email),
    adresse: chaine(r.adresse),
    codePostal: chaine(r.code_postal),
    ville: chaine(r.ville),
    qualification: chaine(r.qualification),
    dateVisiteMedicale: chaine(r.date_visite_medicale),
    dateFinContrat: chaine(r.date_fin_contrat),
    commentaire: chaine(r.commentaire),
  };
}
