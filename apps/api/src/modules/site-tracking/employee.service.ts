import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import Decimal from 'decimal.js';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import { NumberingService } from '../../core/numbering/numbering.service';

export type ContractType = 'salarie' | 'interimaire' | 'apprenti';

export interface EmployeeInput {
  firstName?: string | null;
  lastName?: string;
  jobTitle?: string | null;
  hourlyCost?: string | number;
  contractType?: ContractType;
  active?: boolean;
}

export interface EmployeeRow {
  id: string;
  code: string;
  firstName: string | null;
  lastName: string;
  fullName: string;
  jobTitle: string | null;
  hourlyCost: string;
  contractType: ContractType;
  active: boolean;
}

const CONTRACTS: ContractType[] = ['salarie', 'interimaire', 'apprenti'];

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
        `SELECT id, code, first_name, last_name, job_title, hourly_cost, contract_type, active
           FROM employee
          WHERE deleted_at IS NULL ${includeInactive ? '' : 'AND active = true'}
          ORDER BY last_name, first_name NULLS FIRST`,
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

    return runInTenant(this.dataSource, tenantId, async (em) => {
      const code = await this.numbering.next(em, 'employee');
      const rows = await em.query(
        `INSERT INTO employee
           (tenant_id, code, first_name, last_name, job_title, hourly_cost, contract_type, active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, code, first_name, last_name, job_title, hourly_cost, contract_type, active`,
        [
          tenantId,
          code,
          (input.firstName ?? '').trim() || null,
          lastName,
          (input.jobTitle ?? '').trim() || null,
          hourlyCost,
          contractType,
          input.active ?? true,
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

      const rows = await em.query(
        `UPDATE employee
            SET first_name = $2, last_name = $3, job_title = $4, hourly_cost = $5,
                contract_type = $6, active = $7, updated_at = now()
          WHERE id = $1
          RETURNING id, code, first_name, last_name, job_title, hourly_cost, contract_type, active`,
        [
          id,
          input.firstName === undefined ? current.first_name : (input.firstName ?? '').trim() || null,
          lastName,
          input.jobTitle === undefined ? current.job_title : (input.jobTitle ?? '').trim() || null,
          input.hourlyCost === undefined ? current.hourly_cost : check(input.hourlyCost),
          input.contractType === undefined ? current.contract_type : checkContract(input.contractType),
          input.active === undefined ? current.active : input.active,
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

function check(v: string | number | undefined): string {
  const d = new Decimal(v ?? 0);
  if (d.isNegative()) throw new BadRequestException('Le coût horaire ne peut pas être négatif.');
  return d.toDecimalPlaces(4).toFixed(4);
}

function checkContract(v: ContractType | undefined): ContractType {
  if (v === undefined) return 'salarie';
  if (!CONTRACTS.includes(v)) {
    throw new BadRequestException('Type de contrat inconnu (salarie, interimaire, apprenti).');
  }
  return v;
}

function toRow(r: {
  id: string; code: string; first_name: string | null; last_name: string;
  job_title: string | null; hourly_cost: string; contract_type: ContractType; active: boolean;
}): EmployeeRow {
  return {
    id: r.id,
    code: r.code,
    firstName: r.first_name,
    lastName: r.last_name,
    fullName: [r.first_name, r.last_name].filter(Boolean).join(' '),
    jobTitle: r.job_title,
    hourlyCost: r.hourly_cost,
    contractType: r.contract_type,
    active: r.active,
  };
}
