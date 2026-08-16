'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, PackageCheck, ReceiptText } from 'lucide-react';
import { euro } from '@/lib/format';
import { STATUT_AVANCEMENT, statut } from '@/lib/statuts';
import { BadgeStatut, LigneVide } from './ui';

/* ─────────── formes renvoyées par le registre ─────────── */

export interface BonLivraison {
  id: string;
  code: string;
  recuLe: string | null;
  nbLignes: number;
  montant: string;
}
export interface GroupeReception {
  orderId: string;
  commande: string;
  statut: string;
  totalHt: string;
  chantierCode: string | null;
  chantierNom: string | null;
  chantierCouleur: string | null;
  fournisseur: string | null;
  nbBl: number;
  derniereReception: string | null;
  montantRecu: string;
  etat: 'partielle' | 'complete';
  bons: BonLivraison[];
}
export interface FactureFournisseur {
  id: string;
  code: string;
  montantHt: string;
  date: string | null;
  nature: string;
  codeAnalytique: string | null;
}
export interface GroupeFacture {
  cle: string;
  orderId: string | null;
  commande: string | null;
  totalCommande: string | null;
  chantierCode: string | null;
  chantierNom: string | null;
  chantierCouleur: string | null;
  fournisseur: string | null;
  nbFactures: number;
  montantFacture: string;
  derniereFacture: string | null;
  factures: FactureFournisseur[];
}

const NATURES: Record<string, string> = {
  material: 'Matériaux', equipment: 'Matériel', subcontract: 'Sous-traitance',
  labor: 'Main d’œuvre', site_overhead: 'Frais de chantier',
};

function jour(v: string | null): string {
  return v ? new Date(v).toLocaleDateString('fr-FR') : '—';
}

/** Pastille + code du chantier : la colonne n'existe que dans la vue d'entreprise. */
function Chantier({ g }: { g: { chantierCode: string | null; chantierNom: string | null; chantierCouleur: string | null } }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {g.chantierCouleur && (
        <span style={{ width: 10, height: 10, borderRadius: 2, background: g.chantierCouleur }} />
      )}
      {g.chantierCode ?? '—'}
      {g.chantierNom && <span className="muted" style={{ fontSize: 11 }}>{g.chantierNom}</span>}
    </span>
  );
}

function Chevron({ ouvert }: { ouvert: boolean }) {
  return <td style={{ color: 'var(--muted)' }}>{ouvert ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>;
}

/**
 * Tableau des réceptions groupées par commande — partagé par le registre d'entreprise et par
 * l'espace Achats d'un chantier, pour qu'on retrouve la même lecture des deux côtés.
 *
 * Une commande reçoit rarement tout d'un coup : trois ou quatre bons chacune, et la liste à plat
 * devenait un mur de pièces où la seule question qui compte — cette commande est-elle arrivée ? —
 * ne se lisait plus. L'état se lit donc sur la ligne de la commande, le détail se déplie dessous.
 */
export function TableauReceptions({
  lignes,
  lienCommande,
  avecChantier = true,
  vide = 'Aucune réception ne correspond à cette recherche.',
}: {
  lignes: GroupeReception[];
  lienCommande: (orderId: string) => string;
  avecChantier?: boolean;
  vide?: string;
}) {
  const [ouverts, setOuverts] = useState<Record<string, boolean>>({});
  const colonnes = avecChantier ? 9 : 8;

  return (
    <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
      <table className="grid" style={{ margin: 0 }}>
        <thead>
          <tr>
            <th style={{ width: 28 }}></th>
            <th style={{ width: 150 }}>Commande</th>
            {avecChantier && <th>Chantier</th>}
            <th>Fournisseur</th>
            <th style={{ width: 110 }}>Dernier BL</th>
            <th style={{ width: 60, textAlign: 'right' }}>BL</th>
            <th style={{ width: 120, textAlign: 'right' }}>Reçu</th>
            <th style={{ width: 120, textAlign: 'right' }}>Commandé</th>
            <th style={{ width: 110 }}>État</th>
          </tr>
        </thead>
        <tbody>
          {lignes.map((g) => {
            const ouvert = Boolean(ouverts[g.orderId]);
            return [
              <tr
                key={g.orderId}
                style={{ cursor: 'pointer' }}
                onClick={() => setOuverts((o) => ({ ...o, [g.orderId]: !o[g.orderId] }))}
              >
                <Chevron ouvert={ouvert} />
                <td onClick={(e) => e.stopPropagation()}>
                  <Link href={lienCommande(g.orderId)} className="link code-cell">{g.commande}</Link>
                </td>
                {avecChantier && <td><Chantier g={g} /></td>}
                <td>{g.fournisseur ?? <span className="muted">Non renseigné</span>}</td>
                <td className="muted">{jour(g.derniereReception)}</td>
                <td style={{ textAlign: 'right' }}>{g.nbBl}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euro(g.montantRecu)}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euro(g.totalHt)}</td>
                <td><BadgeStatut statut={statut(STATUT_AVANCEMENT, g.etat)} /></td>
              </tr>,
              ...(ouvert ? g.bons.map((b) => (
                <tr key={b.id} style={{ background: 'var(--surface)' }}>
                  <td></td>
                  <td className="code-cell" style={{ paddingLeft: 18 }}>{b.code}</td>
                  <td className="muted" colSpan={avecChantier ? 2 : 1}>
                    {b.nbLignes > 0
                      ? `${b.nbLignes} ligne${b.nbLignes > 1 ? 's' : ''} reçue${b.nbLignes > 1 ? 's' : ''}`
                      : 'Saisie globale, sans détail de lignes'}
                  </td>
                  <td className="muted">{jour(b.recuLe)}</td>
                  <td></td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {Number(b.montant) === 0 ? <span className="muted">—</span> : euro(b.montant)}
                  </td>
                  <td colSpan={2}></td>
                </tr>
              )) : []),
            ];
          })}
          {lignes.length === 0 && (
            <LigneVide
              colonnes={colonnes}
              icone={PackageCheck}
              titre={vide}
              indice="Une réception s’enregistre depuis la commande concernée, ligne à ligne."
            />
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Tableau des factures groupées par commande — même principe, et la comparaison qui compte :
 * facturé contre commandé. Une facture sans commande (saisie directe sur un chantier) se range
 * sous son chantier : elle n'a pas de bon de commande, ce n'est pas une raison pour la faire
 * disparaître du registre.
 */
export function TableauFactures({
  lignes,
  lienCommande,
  avecChantier = true,
  vide = 'Aucune facture ne correspond à cette recherche.',
}: {
  lignes: GroupeFacture[];
  lienCommande: (orderId: string) => string;
  avecChantier?: boolean;
  vide?: string;
}) {
  const [ouverts, setOuverts] = useState<Record<string, boolean>>({});
  const colonnes = avecChantier ? 9 : 8;

  return (
    <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
      <table className="grid" style={{ margin: 0 }}>
        <thead>
          <tr>
            <th style={{ width: 28 }}></th>
            <th style={{ width: 160 }}>Commande</th>
            {avecChantier && <th>Chantier</th>}
            <th>Fournisseur</th>
            <th style={{ width: 110 }}>Dernière facture</th>
            <th style={{ width: 60, textAlign: 'right' }}>Fact.</th>
            <th style={{ width: 120, textAlign: 'right' }}>Facturé HT</th>
            <th style={{ width: 120, textAlign: 'right' }}>Commandé HT</th>
            <th style={{ width: 110, textAlign: 'right' }}>Écart</th>
          </tr>
        </thead>
        <tbody>
          {lignes.map((g) => {
            const ouvert = Boolean(ouverts[g.cle]);
            const ecart = g.totalCommande != null
              ? Number(g.montantFacture) - Number(g.totalCommande) : null;
            return [
              <tr
                key={g.cle}
                style={{ cursor: 'pointer' }}
                onClick={() => setOuverts((o) => ({ ...o, [g.cle]: !o[g.cle] }))}
              >
                <Chevron ouvert={ouvert} />
                <td onClick={(e) => e.stopPropagation()}>
                  {g.orderId
                    ? <Link href={lienCommande(g.orderId)} className="link code-cell">{g.commande}</Link>
                    : <span className="muted">Hors commande</span>}
                </td>
                {avecChantier && <td><Chantier g={g} /></td>}
                <td>{g.fournisseur ?? <span className="muted">Non renseigné</span>}</td>
                <td className="muted">{jour(g.derniereFacture)}</td>
                <td style={{ textAlign: 'right' }}>{g.nbFactures}</td>
                <td style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {euro(g.montantFacture)}
                </td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {g.totalCommande != null ? euro(g.totalCommande) : <span className="muted">—</span>}
                </td>
                {/* L'écart ne se colore qu'en dépassement : facturer moins que commandé est le cas
                    normal d'une commande encore en cours. */}
                <td style={{
                  textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                  color: ecart != null && ecart > 0 ? '#dc2626' : undefined,
                }}>
                  {ecart == null ? <span className="muted">—</span> : euro(ecart.toFixed(2))}
                </td>
              </tr>,
              ...(ouvert ? g.factures.map((f) => (
                <tr key={f.id} style={{ background: 'var(--surface)' }}>
                  <td></td>
                  <td className="code-cell" style={{ paddingLeft: 18 }}>{f.code}</td>
                  {/* Nature et imputation tiennent sur une seule cellule : ce sont des précisions
                      sur la pièce, pas des colonnes du tableau. */}
                  <td className="muted" colSpan={avecChantier ? 2 : 1}>
                    {NATURES[f.nature] ?? f.nature}
                    {' · '}
                    {f.codeAnalytique
                      ? <span className="code-cell">{f.codeAnalytique}</span>
                      : 'à ventiler'}
                  </td>
                  <td className="muted">{jour(f.date)}</td>
                  <td></td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {euro(f.montantHt)}
                  </td>
                  <td colSpan={2}></td>
                </tr>
              )) : []),
            ];
          })}
          {lignes.length === 0 && (
            <LigneVide
              colonnes={colonnes}
              icone={ReceiptText}
              titre={vide}
              indice="Une facture fournisseur s’enregistre depuis la commande qu’elle règle."
            />
          )}
        </tbody>
      </table>
    </div>
  );
}
