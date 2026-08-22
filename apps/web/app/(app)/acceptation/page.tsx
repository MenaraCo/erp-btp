'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ArrowRight, Building2, Lock, Receipt } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api';
import { euro } from '@/lib/format';
import { Alerte, Bouton } from '@/components/ui';
import { useCapabilities } from '@/lib/capabilities';
import { ACCEPTANCE_CAPABILITIES } from '@/lib/modules';

interface PendingRow {
  devisId: string;
  numero: string | null;
  designation: string;
  affaireId: string;
  affaireCode: string;
  affaireName: string;
  clientName: string | null;
  montantHt: string;
  updatedAt: string;
}

interface AcceptedRow {
  marcheId: string;
  code: string;
  name: string;
  totalHt: string;
  acceptedAt: string;
  chantierId: string;
  chantierCode: string;
  chantierName: string;
  devisId: string;
  numero: string | null;
  affaireCode: string;
  clientName: string | null;
}

interface Sheet {
  devis: {
    id: string;
    numero: string | null;
    designation: string;
    status: string;
    affaireId: string;
    affaireCode: string;
    affaireName: string;
    versionNo: number | null;
  };
  client: { id: string; name: string; email: string | null } | null;
  montants: {
    debourse: string;
    pvHt: string;
    tva: string;
    ttc: string;
    optionsPvHt: string;
    variantesPvHt: string;
  };
  sections: {
    lineId: string;
    code: string | null;
    designation: string;
    sectionType: 'option' | 'variante';
    montantHt: string;
  }[];
  chantiers: { id: string; code: string; name: string }[];
  suggestedChantierCode: string;
  acceptable: boolean;
  alerts: { level: 'blocking' | 'warning'; message: string }[];
}

/**
 * Acceptation de commande — la charnière entre l'étude de prix et l'exécution.
 * Un devis gagné y devient un marché posé sur un chantier : la facturation y prend ses
 * situations, le suivi de chantier ses budgets. Rien d'autre ne fait ce passage.
 */
export default function AcceptationPage() {
  const { token } = useAuth();
  const caps = useCapabilities();
  const [selected, setSelected] = useState<string | null>(null);

  const pending = useQuery({
    queryKey: ['acceptance-pending'],
    enabled: Boolean(token),
    queryFn: () => apiFetch<PendingRow[]>('/acceptance/pending', { token }),
  });
  const accepted = useQuery({
    queryKey: ['acceptance-accepted'],
    enabled: Boolean(token),
    queryFn: () => apiFetch<AcceptedRow[]>('/acceptance/accepted', { token }),
  });

  const unlocked = caps.isLoading || caps.hasAny(...ACCEPTANCE_CAPABILITIES);
  if (!unlocked) {
    return (
      <div>
        <h1>Acceptation de commande</h1>
        <div className="card" style={{ marginTop: 16, textAlign: 'center', padding: 32 }}>
          <Lock size={22} style={{ color: 'var(--muted)' }} />
          <h2 style={{ marginTop: 8 }}>Outil non souscrit</h2>
          <p className="muted" style={{ maxWidth: 520, margin: '8px auto 16px' }}>
            L’acceptation de commande transforme un devis gagné en marché et en chantier. Elle n’a
            d’intérêt qu’avec la <strong>Facturation</strong> (situations, factures, DGD) ou le{' '}
            <strong>Suivi de chantiers</strong> (budgets, pointages) : souscrivez l’un des deux
            pour l’activer.
          </p>
          <a className="btn" href="/abonnement">Voir mon abonnement</a>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1>Acceptation de commande</h1>
        <span className="muted" style={{ fontSize: 12 }}>
          Devis gagné → marché + chantier → facturation &amp; suivi
        </span>
      </div>

      <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <h2 style={{ margin: 0 }}>À accepter</h2>
          <p className="muted" style={{ margin: '2px 0 0', fontSize: 12 }}>
            Devis gagnés qui n’ont pas encore donné de marché.
          </p>
        </div>
        {pending.isLoading && <p className="muted" style={{ padding: 16 }}>Chargement…</p>}
        {pending.isError && (
          <p className="muted" style={{ padding: 16 }}>Liste indisponible.</p>
        )}
        {pending.data && pending.data.length === 0 && (
          <p className="muted" style={{ padding: 16 }}>
            Aucune commande en attente. Un devis apparaît ici dès qu’il est marqué « Gagné ».
          </p>
        )}
        {pending.data && pending.data.length > 0 && (
          <table className="grid" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th>Devis</th>
                <th>Affaire</th>
                <th>Client</th>
                <th style={{ textAlign: 'right' }}>Montant HT</th>
                <th style={{ width: 150 }} />
              </tr>
            </thead>
            <tbody>
              {pending.data.map((p) => (
                <tr key={p.devisId}>
                  <td>
                    <span className="code-cell">{p.numero ?? '—'}</span>{' '}
                    <span style={{ fontWeight: 500 }}>{p.designation}</span>
                  </td>
                  <td className="muted">{p.affaireCode} — {p.affaireName}</td>
                  <td>{p.clientName ?? '—'}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {euro(p.montantHt)}
                  </td>
                  <td style={{ textAlign: 'right', paddingRight: 8 }}>
                    <button
                      className="btn"
                      style={{ fontSize: 12, padding: '4px 10px' }}
                      onClick={() => setSelected(p.devisId)}
                    >
                      Accepter <ArrowRight size={12} style={{ verticalAlign: 'middle' }} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <h2 style={{ margin: 0 }}>Commandes acceptées</h2>
          <p className="muted" style={{ margin: '2px 0 0', fontSize: 12 }}>
            Chaque ligne mène au chantier (budgets, pointages) ou à sa facturation.
          </p>
        </div>
        {accepted.data && accepted.data.length === 0 && (
          <p className="muted" style={{ padding: 16 }}>Aucune commande acceptée pour l’instant.</p>
        )}
        {accepted.data && accepted.data.length > 0 && (
          <AcceptedTable rows={accepted.data} />
        )}
      </div>

      {selected && (
        <AcceptanceModal
          devisId={selected}
          onClose={() => setSelected(null)}
          onDone={() => {
            setSelected(null);
            pending.refetch();
            accepted.refetch();
          }}
        />
      )}
    </div>
  );
}

function AcceptedTable({ rows }: { rows: AcceptedRow[] }) {
  const router = useRouter();
  return (
    <table className="grid" style={{ margin: 0 }}>
      <thead>
        <tr>
          <th>Marché</th>
          <th>Chantier</th>
          <th>Client</th>
          <th style={{ textAlign: 'right' }}>Montant HT</th>
          <th style={{ width: 190 }} />
        </tr>
      </thead>
      <tbody>
        {rows.map((a) => (
          <tr key={a.marcheId}>
            <td>
              <span className="code-cell">{a.code}</span>{' '}
              <span style={{ fontWeight: 500 }}>{a.name}</span>
            </td>
            <td className="muted">{a.chantierCode} — {a.chantierName}</td>
            <td>{a.clientName ?? '—'}</td>
            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {euro(a.totalHt)}
            </td>
            <td style={{ textAlign: 'right', paddingRight: 8, whiteSpace: 'nowrap' }}>
              <Bouton
                variante="secondaire"
                icone={Building2}
                onClick={() => router.push(`/chantiers/${a.chantierId}`)}
              >
                Chantier
              </Bouton>{' '}
              <Bouton
                variante="secondaire"
                icone={Receipt}
                onClick={() => router.push(`/invoicing/${a.marcheId}`)}
              >
                Facturation
              </Bouton>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', zIndex: 1000,
  display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
  padding: '40px 20px', overflowY: 'auto',
};

/** Fiche d'acceptation : ce qu'on signe, ce que le client retient, et où ça atterrit. */
function AcceptanceModal({
  devisId,
  onClose,
  onDone,
}: {
  devisId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [target, setTarget] = useState<'new' | string>('new');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ chantierId: string; marcheId: string } | null>(null);
  const router = useRouter();

  /**
   * Que faire des frais généraux et des frais annexes du devis ? Aucune réponse n'est bonne en
   * général : une entreprise garde ses FG au siège, une autre veut les voir sur le chantier, et
   * le compte prorata est tantôt un coût, tantôt une recette en moins. On demande donc, plutôt
   * que d'imposer — et « les isoler » reste le défaut, celui qui ne décide rien à votre place.
   */
  const [traitementFrais, setTraitementFrais] = useState<'ignorer' | 'isoler' | 'ventiler'>('isoler');

  const { data: sheet, isLoading } = useQuery({
    queryKey: ['acceptance-sheet', devisId],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Sheet>(`/acceptance/devis/${devisId}`, { token }),
  });

  const accept = useMutation({
    mutationFn: () =>
      apiFetch<{ chantier: { id: string }; marche: { id: string } }>(`/devis/${devisId}/accept`, {
        method: 'POST',
        token,
        body: { chantierId: target === 'new' ? null : target, traitementFrais },
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['chantiers'] });
      qc.invalidateQueries({ queryKey: ['marches'] });
      setDone({ chantierId: res.chantier.id, marcheId: res.marche.id });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Acceptation impossible.'),
  });

  const totalCommande = Number(sheet?.montants.pvHt ?? 0);

  return (
    <div style={overlay} onClick={onClose}>
      <div
        className="card"
        style={{ borderRadius: 12, padding: '24px 28px', width: 660, maxWidth: '100%' }}
        onClick={(e) => e.stopPropagation()}
      >
        {isLoading && <p className="muted">Chargement de la fiche…</p>}

        {done && (
          <>
            <h2>Commande acceptée</h2>
            <p className="muted">
              Le marché et le chantier sont créés. Les budgets d’exécution reprennent le déboursé
              du devis ; la facturation peut établir ses situations sur ce marché.
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <Bouton onClick={() => router.push(`/chantiers/${done.chantierId}`)}>
                Ouvrir le chantier
              </Bouton>
              <Bouton
                variante="secondaire"
                onClick={() => router.push(`/invoicing/${done.marcheId}`)}
              >
                Aller à la facturation
              </Bouton>
              <button className="link" onClick={onDone}>Fermer</button>
            </div>
          </>
        )}

        {sheet && !done && (
          <>
            <h2 style={{ marginTop: 0 }}>
              Accepter « {sheet.devis.numero ?? sheet.devis.designation} »
            </h2>
            <p className="muted" style={{ marginTop: -4 }}>
              {sheet.devis.affaireCode} — {sheet.devis.affaireName}
              {sheet.client ? ` · ${sheet.client.name}` : ''}
              {sheet.devis.versionNo ? ` · version ${sheet.devis.versionNo}` : ''}
            </p>

            {sheet.alerts.map((a, i) => (
              <div
                key={i}
                className={a.level === 'blocking' ? 'error' : ''}
                style={
                  a.level === 'blocking'
                    ? { marginBottom: 8 }
                    : {
                        marginBottom: 8, fontSize: 12, color: '#92400e',
                        background: '#fef3c7', padding: '6px 10px', borderRadius: 6,
                      }
                }
              >
                {a.message}
              </div>
            ))}

            <div className="field">
              <label>Montants du devis</label>
              <table className="grid" style={{ margin: 0 }}>
                <tbody>
                  <tr>
                    <td>Déboursé d’étude</td>
                    <td style={{ textAlign: 'right' }}>{euro(sheet.montants.debourse)}</td>
                  </tr>
                  <tr>
                    <td>Total HT (tronc commun)</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                      {euro(sheet.montants.pvHt)}
                    </td>
                  </tr>
                  <tr>
                    <td className="muted">TVA</td>
                    <td style={{ textAlign: 'right' }} className="muted">{euro(sheet.montants.tva)}</td>
                  </tr>
                  <tr>
                    <td className="muted">TTC</td>
                    <td style={{ textAlign: 'right' }} className="muted">{euro(sheet.montants.ttc)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {sheet.sections.length > 0 && (
              <div className="field">
                <label>Options et variantes du devis — hors commande</label>
                <p className="muted" style={{ fontSize: 11, margin: '0 0 6px' }}>
                  Elles ne sont pas reprises au marché. Si le client en retient, intégrez-les au
                  devis avant de l’accepter.
                </p>
                <table className="grid" style={{ margin: 0 }}>
                  <tbody>
                    {sheet.sections.map((s) => (
                      <tr key={s.lineId}>
                        <td>
                          <span className="badge">{s.sectionType === 'option' ? 'Option' : 'Variante'}</span>{' '}
                          {s.code ? <span className="code-cell">{s.code}</span> : null} {s.designation}
                        </td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {euro(s.montantHt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="field">
              <label>Chantier de rattachement</label>
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="new">
                  Nouveau chantier ({sheet.suggestedChantierCode})
                </option>
                {sheet.chantiers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
              <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                Un chantier porte plusieurs marchés (un par lot gagné) : les coûts s’agrègent au
                chantier, la facturation reste propre à chaque marché.
              </p>
            </div>

            <div className="field" style={{ marginTop: 4 }}>
              <label>Frais généraux et frais annexes du devis</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[
                  {
                    v: 'isoler' as const,
                    t: 'Les isoler et choisir ensuite',
                    d: 'Ils forment un bon de budget à traiter : vous choisissez leur poste et leur signe (un compte prorata est souvent une recette en moins). Ils ne comptent nulle part tant que ce n’est pas fait.',
                  },
                  {
                    v: 'ventiler' as const,
                    t: 'Les ventiler sur les charges',
                    d: 'Ils entrent tout de suite au budget du chantier, sans poste analytique — à ranger ensuite depuis « à ventiler ».',
                  },
                  {
                    v: 'ignorer' as const,
                    t: 'Ne pas en tenir compte',
                    d: 'Le chantier ne portera pas ces frais : ils restent au siège. Sa marge s’en trouvera flattée d’autant.',
                  },
                ].map((o) => (
                  <label key={o.v} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13 }}>
                    <input
                      type="radio"
                      name="traitement-frais"
                      checked={traitementFrais === o.v}
                      onChange={() => setTraitementFrais(o.v)}
                      style={{ marginTop: 3 }}
                    />
                    <span>
                      <strong>{o.t}</strong>
                      <span className="muted" style={{ display: 'block', fontSize: 11 }}>{o.d}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4,
              }}
            >
              <div>
                <span className="muted" style={{ fontSize: 12 }}>Montant de la commande&nbsp;</span>
                <strong style={{ fontSize: 15 }}>{euro(totalCommande)}</strong>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="link" onClick={onClose}>Annuler</button>
                <button
                  className="btn"
                  disabled={!sheet.acceptable || accept.isPending}
                  onClick={() => { setError(null); accept.mutate(); }}
                >
                  {accept.isPending ? 'Acceptation…' : 'Accepter la commande'}
                </button>
              </div>
            </div>
            {error && <Alerte>{error}</Alerte>}
          </>
        )}
      </div>
    </div>
  );
}
