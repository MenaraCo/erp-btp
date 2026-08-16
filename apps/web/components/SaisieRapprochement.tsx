'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiFetch, apiUpload, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { euro } from '@/lib/format';
import { Modale } from '@/components/Modale';

export interface LigneRapprochement {
  orderLineId: string;
  designation: string;
  ouvrage: string | null;
  uniteAchat: string | null;
  codeAnalytique: string | null;
  quantiteCommandee: string;
  puCommande: string;
  montantCommande: string;
  quantiteRecue: string;
  resteARecevoir: string;
  quantiteFacturee: string;
  resteAFacturer: string;
  puFacture: string | null;
  montantFacture: string;
  ecartPrix: string;
}

/**
 * Saisie d'une réception ou d'une facture, LIGNE À LIGNE.
 *
 * On repart des lignes de la commande — on ne resaisit pas ce qui a déjà été écrit. Le champ à
 * remplir est pré-rempli avec ce qui reste : le cas courant est « tout est arrivé », et il ne
 * doit pas coûter dix frappes. Pour une facture, le prix aussi se saisit : c'est la comparaison
 * du PU facturé au PU commandé qui révèle le sac facturé plus cher que commandé.
 */
export function SaisieRapprochement({
  mode,
  orderId,
  lignes,
  onClose,
  onEnregistre,
}: {
  mode: 'reception' | 'facture';
  orderId: string;
  lignes: LigneRapprochement[];
  onClose: () => void;
  onEnregistre: (message: string) => void;
}) {
  const { token } = useAuth();
  const facture = mode === 'facture';
  const reste = (l: LigneRapprochement) => (facture ? l.resteAFacturer : l.resteARecevoir);

  const [quantites, setQuantites] = useState<Record<string, string>>(
    () => Object.fromEntries(lignes.map((l) => [l.orderLineId, reste(l)])),
  );
  const [prix, setPrix] = useState<Record<string, string>>(
    () => Object.fromEntries(lignes.map((l) => [l.orderLineId, l.puCommande])),
  );
  const [code, setCode] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [err, setErr] = useState<string | null>(null);
  const [lecture, setLecture] = useState<string | null>(null);

  /**
   * Import du justificatif reçu : le document est conservé avec la commande, et ce qu'on parvient
   * à y lire pré-remplit les quantités. Ce qui n'est pas reconnu reste vide — une quantité
   * inventée dans un rapprochement coûte plus cher qu'une case à saisir.
   */
  const importer = useMutation({
    mutationFn: (fichier: File) => apiUpload<{
      document: { lecture: string; nomFichier: string };
      propositions: Array<{ orderLineId: string; quantiteLue: string | null; puLu: string | null }>;
      message: string;
    }>(`/purchase-orders/${orderId}/documents?type=${facture ? 'invoice' : 'delivery'}`, fichier, token),
    onSuccess: (r) => {
      setLecture(r.message);
      const q = { ...quantites };
      const p = { ...prix };
      for (const proposition of r.propositions) {
        if (proposition.quantiteLue !== null) q[proposition.orderLineId] = proposition.quantiteLue;
        if (facture && proposition.puLu) p[proposition.orderLineId] = proposition.puLu;
      }
      setQuantites(q);
      setPrix(p);
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Import impossible.'),
  });

  const total = lignes.reduce(
    (t, l) => t + Number(quantites[l.orderLineId] || 0) * Number(facture ? prix[l.orderLineId] || 0 : l.puCommande),
    0,
  );
  const ecart = facture
    ? lignes.reduce(
      (t, l) => t + Number(quantites[l.orderLineId] || 0) * (Number(prix[l.orderLineId] || 0) - Number(l.puCommande)),
      0,
    )
    : 0;

  const enregistrer = useMutation({
    mutationFn: () => apiFetch<{ code: string; etat: string }>(
      `/purchase-orders/${orderId}/${facture ? 'factures' : 'receptions'}`,
      {
        method: 'POST', token,
        body: {
          code: code.trim() || undefined,
          date,
          lignes: lignes
            .filter((l) => Number(quantites[l.orderLineId] || 0) > 0)
            .map((l) => ({
              orderLineId: l.orderLineId,
              quantite: quantites[l.orderLineId],
              ...(facture ? { puFacture: prix[l.orderLineId] } : {}),
            })),
        },
      },
    ),
    onSuccess: (r) => onEnregistre(
      `${facture ? 'Facture' : 'Réception'} ${r.code} enregistrée — ${
        r.etat === 'complete' ? 'commande complète' : 'partielle'}.`,
    ),
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Enregistrement impossible.'),
  });

  const rienASaisir = lignes.every((l) => Number(quantites[l.orderLineId] || 0) <= 0);

  return (
    <Modale
      titre={facture ? 'Enregistrer une facture fournisseur' : 'Réceptionner la commande'}
      sousTitre={facture
        ? 'Quantités et prix facturés, comparés à la commande. Les écarts apparaissent à droite.'
        : 'Quantités réellement livrées. Ce qui reste attendu restera dû sur la commande.'}
      largeur="xl"
      onClose={onClose}
      actions={(
        <>
          {facture && (
            <span className="muted" style={{ fontSize: 12, marginRight: 'auto' }}>
              Écart total :{' '}
              <strong style={{ color: ecart > 0 ? 'var(--danger, #dc2626)' : undefined }}>
                {euro(ecart.toFixed(2))}
              </strong>
            </span>
          )}
          <strong style={{ marginLeft: facture ? undefined : 'auto' }}>{euro(total.toFixed(2))}</strong>
          <button className="btn btn-secondary" onClick={onClose}>Annuler</button>
          <button
            className="btn"
            disabled={rienASaisir || (facture && !code.trim()) || enregistrer.isPending}
            title={facture && !code.trim() ? 'Le numéro de facture du fournisseur est requis' : undefined}
            onClick={() => { setErr(null); enregistrer.mutate(); }}
          >
            {enregistrer.isPending ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </>
      )}
    >
      <>
        {err && <div className="error" style={{ marginBottom: 12 }}>{err}</div>}

        <div className="card" style={{ padding: '10px 12px', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 12 }}>
              {facture ? 'Facture reçue' : 'Bon de livraison reçu'}
            </strong>
            <label className="btn btn-secondary" style={{ cursor: 'pointer', margin: 0 }}>
              Importer le document…
              <input
                type="file"
                accept="application/pdf,image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) { setErr(null); importer.mutate(f); }
                  e.target.value = '';
                }}
              />
            </label>
            <span className="muted" style={{ fontSize: 11 }}>
              {importer.isPending
                ? 'Lecture du document…'
                : 'PDF ou photo. Les quantités lisibles seront pré-remplies.'}
            </span>
          </div>
          {lecture && (
            <div style={{ fontSize: 12, marginTop: 8, color: 'var(--primary)' }}>{lecture}</div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>{facture ? 'N° de facture *' : 'N° de BL'}</label>
            <input
              value={code}
              placeholder={facture ? 'Celui du fournisseur' : 'Numéro automatique'}
              onChange={(e) => setCode(e.target.value)}
              style={{ width: 180 }}
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 150 }} />
          </div>
        </div>

        <div style={{ maxHeight: '46vh', overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
          <table className="grid" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th>Désignation</th>
                <th style={{ textAlign: 'right', width: 90 }}>Commandé</th>
                <th style={{ textAlign: 'right', width: 90 }}>
                  Déjà {facture ? 'facturé' : 'reçu'}
                </th>
                <th style={{ textAlign: 'right', width: 90 }}>Reste</th>
                <th style={{ textAlign: 'right', width: 110 }}>
                  {facture ? 'Qté facturée' : 'Qté livrée'}
                </th>
                {facture && <th style={{ textAlign: 'right', width: 110 }}>PU facturé</th>}
                {facture && <th style={{ textAlign: 'right', width: 100 }}>Écart</th>}
              </tr>
            </thead>
            <tbody>
              {lignes.map((l) => {
                const q = Number(quantites[l.orderLineId] || 0);
                const p = Number(prix[l.orderLineId] || 0);
                const e = facture ? q * (p - Number(l.puCommande)) : 0;
                return (
                  <tr key={l.orderLineId}>
                    <td>
                      {l.designation}
                      {l.ouvrage && <span className="muted" style={{ fontSize: 11 }}> · {l.ouvrage}</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {Number(l.quantiteCommandee)} {l.uniteAchat ?? ''}
                    </td>
                    <td style={{ textAlign: 'right' }} className="muted">
                      {Number(facture ? l.quantiteFacturee : l.quantiteRecue)}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{Number(reste(l))}</td>
                    <td style={{ textAlign: 'right' }}>
                      <input
                        type="number" min={0} step="0.01"
                        value={quantites[l.orderLineId] ?? ''}
                        onChange={(ev) => setQuantites({ ...quantites, [l.orderLineId]: ev.target.value })}
                        style={{ width: 90, textAlign: 'right' }}
                      />
                    </td>
                    {facture && (
                      <td style={{ textAlign: 'right' }}>
                        <input
                          type="number" min={0} step="0.01"
                          value={prix[l.orderLineId] ?? ''}
                          onChange={(ev) => setPrix({ ...prix, [l.orderLineId]: ev.target.value })}
                          style={{
                            width: 95, textAlign: 'right',
                            borderColor: p !== Number(l.puCommande) ? 'var(--accent)' : undefined,
                          }}
                          title={`Commandé à ${euro(l.puCommande)}`}
                        />
                      </td>
                    )}
                    {facture && (
                      <td style={{
                        textAlign: 'right', fontWeight: 600,
                        color: e > 0 ? 'var(--danger, #dc2626)' : e < 0 ? 'var(--success, #15803d)' : undefined,
                      }}>
                        {e === 0 ? '—' : euro(e.toFixed(2))}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

      </>
    </Modale>
  );
}
