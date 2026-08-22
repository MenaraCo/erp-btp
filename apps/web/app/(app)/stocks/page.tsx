'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Boxes, Download, Package, PackageMinus, PackagePlus, Warehouse } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api';
import { euro } from '@/lib/format';
import { Alerte, Badge, Bouton, CarteKpi, EtatVide } from '@/components/ui';
import { Modale } from '@/components/Modale';
import { CodeAnalytique, SelectCodeAnalytique } from '@/components/SelectCodeAnalytique';
import { exporterTableau } from '@/lib/export-tableau';

interface Depot {
  id: string; code: string; label: string; type: 'principal' | 'chantier';
  chantier_id: string | null; chantier_code: string | null; chantier_nom: string | null;
}
interface LigneStock {
  article_id: string; code: string; label: string; unit: string | null; pmp: string;
  seuil_alerte: string | null; sous_le_seuil: boolean;
  depot_id: string; depot_code: string; depot_label: string; depot_type: string;
  code_analytique: string | null; quantite: string; valeur: string;
}
interface Mouvement {
  id: string; type: string; date: string; quantite: string; pu: string; montant: string;
  commentaire: string | null; article_code: string; article_label: string; unit: string | null;
  depot_code: string; depot_cible_code: string | null; chantier_code: string | null;
  code_analytique: string | null; auteur: string | null;
}
interface ChantierRef { id: string; code: string; name: string }

const TYPE_LABELS: Record<string, string> = {
  entree: 'Entrée', sortie: 'Sortie', transfert: 'Transfert', inventaire: 'Inventaire',
};
function qte(v: string | null | undefined, unit?: string | null): string {
  return `${Number(v ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ''}`;
}

/**
 * LES STOCKS — ce que l'entreprise possède déjà, et ce qu'il en coûte au chantier.
 *
 * Un stock qu'on ne valorise pas est un coût qui disparaît : le chantier qui pioche au magasin
 * paraît moins cher qu'il n'est, et la marge se dégrade sans qu'on sache où. Ici, chaque entrée
 * recalcule le prix moyen pondéré, chaque sortie part à ce prix et devient une dépense du
 * chantier, imputée au poste analytique de l'article.
 */
export default function StocksPage() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [depotFiltre, setDepotFiltre] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [geste, setGeste] = useState<'entree' | 'sortie' | 'transfert' | null>(null);
  const [nouveauDepot, setNouveauDepot] = useState(false);
  const [nouvelArticle, setNouvelArticle] = useState(false);

  const depots = useQuery({
    queryKey: ['stock-depots'], enabled: Boolean(token), retry: false,
    queryFn: () => apiFetch<Depot[]>('/stock/depots', { token }),
  });
  const etat = useQuery({
    queryKey: ['stock-etat', depotFiltre], enabled: Boolean(token), retry: false,
    queryFn: () => apiFetch<LigneStock[]>(`/stock/etat${depotFiltre ? `?depot=${depotFiltre}` : ''}`, { token }),
  });
  const mouvements = useQuery({
    queryKey: ['stock-mouvements', depotFiltre], enabled: Boolean(token), retry: false,
    queryFn: () => apiFetch<Mouvement[]>(
      `/stock/mouvements${depotFiltre ? `?depot=${depotFiltre}` : ''}`, { token },
    ),
  });
  const chantiers = useQuery({
    queryKey: ['chantiers'], enabled: Boolean(token), retry: false,
    queryFn: () => apiFetch<ChantierRef[]>('/chantiers', { token }),
  });
  const codes = useQuery({
    queryKey: ['params-codes'], enabled: Boolean(token), retry: false,
    queryFn: () => apiFetch<CodeAnalytique[]>('/params/codes', { token }),
  });

  const rafraichir = () => {
    for (const key of [['stock-etat'], ['stock-mouvements'], ['stock-depots'],
      ['chantier-results'], ['chantier-analytical'], ['portfolio']]) {
      qc.invalidateQueries({ queryKey: key });
    }
  };
  const onErr = (e: unknown) => setErr(e instanceof ApiError ? e.message : 'Erreur');

  const mMouvement = useMutation({
    mutationFn: ({ route, body }: { route: string; body: Record<string, unknown> }) =>
      apiFetch(`/stock/${route}`, { method: 'POST', token, body }),
    onSuccess: () => { setErr(null); setGeste(null); rafraichir(); }, onError: onErr,
  });
  const mDepot = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch('/stock/depots', { method: 'POST', token, body }),
    onSuccess: () => { setErr(null); setNouveauDepot(false); rafraichir(); }, onError: onErr,
  });
  const mArticle = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch('/stock/articles', { method: 'POST', token, body }),
    onSuccess: () => { setErr(null); setNouvelArticle(false); rafraichir(); }, onError: onErr,
  });

  const lignes = etat.data ?? [];
  const valeurTotale = lignes.reduce((t, l) => t + Number(l.valeur), 0);
  const alertes = lignes.filter((l) => l.sous_le_seuil);
  // Les articles connus, tirés de l'état : c'est là qu'on choisit ce qu'on entre ou sort.
  const articles = Array.from(
    new Map(lignes.map((l) => [l.article_id, { id: l.article_id, code: l.code, label: l.label, unit: l.unit }])).values(),
  );

  if (etat.isError) {
    return (
      <div>
        <h1>Stocks</h1>
        <p className="muted">
          {etat.error instanceof ApiError && etat.error.status === 403
            ? 'Le module Stocks n’est pas ouvert pour cet utilisateur.'
            : 'Stocks indisponibles.'}
        </p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 320 }}>
          <h1 style={{ marginBottom: 4 }}>Stocks</h1>
          <p className="muted" style={{ marginTop: 0, maxWidth: 780 }}>
            Ce que l'entreprise possède déjà. Chaque <strong>entrée</strong> recalcule le prix moyen pondéré ;
            chaque <strong>sortie</strong> part à ce prix et devient une dépense du chantier servi, imputée au
            poste analytique de l'article. Un stock qu'on ne valorise pas est un coût qui disparaît.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Bouton variante="secondaire" icone={PackagePlus} onClick={() => { setErr(null); setGeste('entree'); }}>
            Entrée
          </Bouton>
          <Bouton variante="secondaire" icone={PackageMinus} onClick={() => { setErr(null); setGeste('sortie'); }}>
            Sortie
          </Bouton>
          <Bouton variante="secondaire" icone={ArrowLeftRight} onClick={() => { setErr(null); setGeste('transfert'); }}>
            Transfert
          </Bouton>
        </div>
      </div>

      {err && <Alerte>{err}</Alerte>}

      <div className="card-grid" style={{ marginTop: 12 }}>
        <CarteKpi titre="Valeur du stock" valeur={euro(valeurTotale)} icone={Boxes}
          detail="Au prix moyen pondéré" />
        <CarteKpi titre="Articles en stock" valeur={String(articles.length)} icone={Package} />
        <CarteKpi titre="Dépôts" valeur={String((depots.data ?? []).length)} icone={Warehouse}
          detail={`${(depots.data ?? []).filter((d) => d.type === 'chantier').length} de chantier`} />
        <CarteKpi titre="Sous le seuil" valeur={String(alertes.length)}
          ton={alertes.length > 0 ? 'danger' : undefined}
          detail={alertes.length > 0 ? 'À réapprovisionner' : 'Rien à signaler'} />
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>État du stock</h2>
          <select value={depotFiltre} onChange={(e) => setDepotFiltre(e.target.value)}>
            <option value="">Tous les dépôts</option>
            {(depots.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} — {d.label}{d.chantier_code ? ` (${d.chantier_code})` : ''}
              </option>
            ))}
          </select>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Bouton
              variante="secondaire"
              icone={Download}
              disabled={lignes.length === 0}
              onClick={() => exporterTableau({
                fichier: 'etat_du_stock',
                titre: 'État du stock',
                sousTitre: `${depotFiltre
                  ? (depots.data ?? []).find((d) => d.id === depotFiltre)?.label ?? ''
                  : 'Tous les dépôts'} — au ${new Date().toLocaleDateString('fr-FR')}`,
                onglet: 'Stock',
                colonnes: [
                  { label: 'Dépôt', type: 'texte', largeur: 22 },
                  { label: 'Article', type: 'texte', largeur: 40 },
                  { label: 'Poste analytique', type: 'texte', largeur: 18 },
                  { label: 'Quantité', type: 'quantite' },
                  { label: 'Unité', type: 'texte', largeur: 10 },
                  { label: 'PMP', type: 'montant' },
                  { label: 'Valeur', type: 'montant' },
                ],
                lignes: [
                  ...lignes.map((l) => ({
                    cellules: [
                      `${l.depot_code} — ${l.depot_label}`,
                      `${l.code} — ${l.label}`,
                      l.code_analytique ?? '',
                      Number(l.quantite),
                      l.unit ?? '',
                      Number(l.pmp),
                      Number(l.valeur),
                    ],
                  })),
                  {
                    genre: 'total' as const,
                    cellules: ['Valeur totale', null, null, null, null, null, valeurTotale],
                  },
                ],
              })}
            >
              Excel
            </Bouton>
            <Bouton variante="secondaire" onClick={() => { setErr(null); setNouvelArticle(true); }}>
              + Article
            </Bouton>
            <Bouton variante="secondaire" onClick={() => { setErr(null); setNouveauDepot(true); }}>
              + Dépôt
            </Bouton>
          </div>
        </div>

        {lignes.length === 0 ? (
          <EtatVide
            icone={Boxes}
            titre="Aucun stock"
            indice="Créez un dépôt et un article, puis enregistrez une entrée : le prix moyen se calcule tout seul."
          />
        ) : (
          <div style={{ overflowX: 'auto', marginTop: 10 }}>
            <table className="grid" style={{ margin: 0, minWidth: 780 }}>
              <thead>
                <tr>
                  <th>Dépôt</th>
                  <th>Article</th>
                  <th>Poste</th>
                  <th style={{ textAlign: 'right' }}>Quantité</th>
                  <th style={{ textAlign: 'right' }}>PMP</th>
                  <th style={{ textAlign: 'right' }}>Valeur</th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((l) => (
                  <tr key={`${l.depot_id}-${l.article_id}`}>
                    <td>
                      {l.depot_code}
                      {l.depot_type === 'chantier' && <Badge ton="info">chantier</Badge>}
                    </td>
                    <td><span className="code-cell">{l.code}</span> {l.label}</td>
                    <td className="muted" style={{ fontSize: 12 }}>{l.code_analytique ?? '— à ventiler'}</td>
                    <td style={{
                      textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                      color: l.sous_le_seuil ? 'var(--danger)' : undefined,
                      fontWeight: l.sous_le_seuil ? 700 : undefined,
                    }}>
                      {qte(l.quantite, l.unit)}
                      {l.sous_le_seuil && <span style={{ fontSize: 11 }}> · sous le seuil</span>}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euro(l.pmp)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euro(l.valeur)}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: '2px solid var(--border)' }}>
                  <td colSpan={5}><strong>Valeur totale</strong></td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{euro(valeurTotale)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>Derniers mouvements</h2>
        {(mouvements.data ?? []).length === 0 ? (
          <p className="muted">Aucun mouvement enregistré.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="grid" style={{ margin: 0, minWidth: 820 }}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Article</th>
                  <th>Dépôt</th>
                  <th style={{ textAlign: 'right' }}>Quantité</th>
                  <th style={{ textAlign: 'right' }}>PU</th>
                  <th style={{ textAlign: 'right' }}>Montant</th>
                  <th>Chantier</th>
                  <th>Par</th>
                </tr>
              </thead>
              <tbody>
                {(mouvements.data ?? []).map((m) => (
                  <tr key={m.id}>
                    <td>{new Date(m.date).toLocaleDateString('fr-FR')}</td>
                    <td>
                      <span className={`badge ${m.type === 'sortie' ? 'warning' : m.type === 'entree' ? 'success' : 'info'}`}>
                        {TYPE_LABELS[m.type] ?? m.type}
                      </span>
                    </td>
                    <td><span className="code-cell">{m.article_code}</span> {m.article_label}</td>
                    <td>
                      {m.depot_code}
                      {m.depot_cible_code && <span className="muted"> → {m.depot_cible_code}</span>}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{qte(m.quantite, m.unit)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euro(m.pu)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euro(m.montant)}</td>
                    <td className="muted" style={{ fontSize: 12 }}>{m.chantier_code ?? ''}</td>
                    <td className="muted" style={{ fontSize: 12 }}>{m.auteur ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {geste && (
        <ModaleMouvement
          geste={geste}
          depots={depots.data ?? []}
          articles={articles}
          chantiers={chantiers.data ?? []}
          pending={mMouvement.isPending}
          erreur={err}
          onClose={() => setGeste(null)}
          onSubmit={(route, body) => mMouvement.mutate({ route, body })}
        />
      )}
      {nouveauDepot && (
        <ModaleDepot
          chantiers={chantiers.data ?? []}
          pending={mDepot.isPending}
          erreur={err}
          onClose={() => setNouveauDepot(false)}
          onSubmit={(body) => mDepot.mutate(body)}
        />
      )}
      {nouvelArticle && (
        <ModaleArticle
          codes={codes.data ?? []}
          pending={mArticle.isPending}
          erreur={err}
          onClose={() => setNouvelArticle(false)}
          onSubmit={(body) => mArticle.mutate(body)}
        />
      )}
    </div>
  );
}

/* ─────────── entrée / sortie / transfert ─────────── */
function ModaleMouvement({
  geste, depots, articles, chantiers, pending, erreur, onClose, onSubmit,
}: {
  geste: 'entree' | 'sortie' | 'transfert';
  depots: Depot[];
  articles: Array<{ id: string; code: string; label: string; unit: string | null }>;
  chantiers: ChantierRef[];
  pending: boolean;
  erreur: string | null;
  onClose: () => void;
  onSubmit: (route: string, body: Record<string, unknown>) => void;
}) {
  const [articleId, setArticleId] = useState('');
  const [depotId, setDepotId] = useState('');
  const [depotCibleId, setDepotCibleId] = useState('');
  const [quantite, setQuantite] = useState('');
  const [pu, setPu] = useState('');
  const [chantierId, setChantierId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [commentaire, setCommentaire] = useState('');

  const titres = {
    entree: 'Entrée en stock', sortie: 'Sortie de stock', transfert: 'Transfert entre dépôts',
  };
  const valide = Boolean(articleId && depotId && quantite && Number(quantite) > 0)
    && (geste !== 'entree' || pu.trim() !== '')
    && (geste !== 'transfert' || Boolean(depotCibleId));

  return (
    <Modale
      titre={titres[geste]}
      sousTitre={
        geste === 'entree' ? 'Elle recalcule le prix moyen pondéré de l’article'
          : geste === 'sortie' ? 'Elle part au prix moyen et devient une dépense du chantier servi'
            : 'La valeur ne bouge pas, seule l’adresse change'
      }
      largeur="m"
      onClose={onClose}
      actions={
        <Bouton
          disabled={!valide}
          chargement={pending}
          onClick={() => onSubmit(
            geste === 'entree' ? 'entrees' : geste === 'sortie' ? 'sorties' : 'transferts',
            {
              articleId, depotId, quantite, date,
              ...(geste === 'entree' ? { pu } : {}),
              ...(geste === 'sortie' ? { chantierId: chantierId || null } : {}),
              ...(geste === 'transfert' ? { depotCibleId } : {}),
              commentaire: commentaire.trim() || null,
            },
          )}
        >
          Enregistrer
        </Bouton>
      }
    >
      {erreur && <Alerte>{erreur}</Alerte>}
      <div className="field">
        <label>Article</label>
        <select value={articleId} onChange={(e) => setArticleId(e.target.value)}>
          <option value="">— choisir —</option>
          {articles.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.label}</option>)}
        </select>
      </div>
      <div className="field">
        <label>{geste === 'transfert' ? 'Dépôt d’origine' : 'Dépôt'}</label>
        <select value={depotId} onChange={(e) => setDepotId(e.target.value)}>
          <option value="">— choisir —</option>
          {depots.map((d) => <option key={d.id} value={d.id}>{d.code} — {d.label}</option>)}
        </select>
      </div>
      {geste === 'transfert' && (
        <div className="field">
          <label>Dépôt d’arrivée</label>
          <select value={depotCibleId} onChange={(e) => setDepotCibleId(e.target.value)}>
            <option value="">— choisir —</option>
            {depots.filter((d) => d.id !== depotId).map((d) => (
              <option key={d.id} value={d.id}>{d.code} — {d.label}</option>
            ))}
          </select>
        </div>
      )}
      {geste === 'sortie' && (
        <div className="field">
          <label>Chantier servi</label>
          <select value={chantierId} onChange={(e) => setChantierId(e.target.value)}>
            <option value="">— consommation interne —</option>
            {chantiers.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
          </select>
          <span className="muted" style={{ fontSize: 11 }}>
            Sans chantier, la sortie ne devient la dépense de personne.
          </span>
        </div>
      )}
      <div style={{ display: 'flex', gap: 12 }}>
        <div className="field" style={{ flex: 1 }}>
          <label>Quantité</label>
          <input type="number" step="any" min={0} value={quantite}
            onChange={(e) => setQuantite(e.target.value)} style={{ textAlign: 'right' }} />
        </div>
        {geste === 'entree' && (
          <div className="field" style={{ flex: 1 }}>
            <label>Prix unitaire (€)</label>
            <input type="number" step="any" min={0} value={pu}
              onChange={(e) => setPu(e.target.value)} style={{ textAlign: 'right' }} />
          </div>
        )}
        <div className="field" style={{ flex: 1 }}>
          <label>Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>Commentaire (facultatif)</label>
        <input value={commentaire} onChange={(e) => setCommentaire(e.target.value)} />
      </div>
    </Modale>
  );
}

/* ─────────── dépôt ─────────── */
function ModaleDepot({
  chantiers, pending, erreur, onClose, onSubmit,
}: {
  chantiers: ChantierRef[];
  pending: boolean;
  erreur: string | null;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [type, setType] = useState<'principal' | 'chantier'>('principal');
  const [chantierId, setChantierId] = useState('');
  const valide = code.trim() !== '' && label.trim() !== '' && (type === 'principal' || Boolean(chantierId));

  return (
    <Modale
      titre="Nouveau dépôt"
      sousTitre="Le magasin, ou du stock déporté sur un chantier"
      largeur="s"
      onClose={onClose}
      actions={
        <Bouton disabled={!valide} chargement={pending}
          onClick={() => onSubmit({ code: code.trim(), label: label.trim(), type, chantierId: chantierId || null })}>
          Créer le dépôt
        </Bouton>
      }
    >
      {erreur && <Alerte>{erreur}</Alerte>}
      <div className="field">
        <label>Code</label>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ex. MAG" />
      </div>
      <div className="field">
        <label>Libellé</label>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ex. Magasin central" />
      </div>
      <div className="field">
        <label>Type</label>
        <select value={type} onChange={(e) => setType(e.target.value as 'principal' | 'chantier')}>
          <option value="principal">Dépôt principal</option>
          <option value="chantier">Dépôt de chantier</option>
        </select>
      </div>
      {type === 'chantier' && (
        <div className="field">
          <label>Chantier</label>
          <select value={chantierId} onChange={(e) => setChantierId(e.target.value)}>
            <option value="">— choisir —</option>
            {chantiers.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
          </select>
        </div>
      )}
    </Modale>
  );
}

/* ─────────── article ─────────── */
function ModaleArticle({
  codes, pending, erreur, onClose, onSubmit,
}: {
  codes: CodeAnalytique[];
  pending: boolean;
  erreur: string | null;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [unit, setUnit] = useState('');
  const [codeAnalytiqueId, setCodeAnalytiqueId] = useState<string | null>(null);
  const [seuil, setSeuil] = useState('');
  const valide = code.trim() !== '' && label.trim() !== '';

  return (
    <Modale
      titre="Nouvel article de stock"
      sousTitre="Son poste analytique suivra chaque sortie vers un chantier"
      largeur="m"
      onClose={onClose}
      actions={
        <Bouton disabled={!valide} chargement={pending}
          onClick={() => onSubmit({
            code: code.trim(), label: label.trim(), unit: unit.trim() || null,
            codeAnalytiqueId, seuilAlerte: seuil || null,
          })}>
          Créer l'article
        </Bouton>
      }
    >
      {erreur && <Alerte>{erreur}</Alerte>}
      <div style={{ display: 'flex', gap: 12 }}>
        <div className="field" style={{ flex: 1 }}>
          <label>Code</label>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ex. CIM32" />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Unité</label>
          <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="ex. sac" />
        </div>
      </div>
      <div className="field">
        <label>Désignation</label>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ex. Ciment 32,5 — sac 35 kg" />
      </div>
      <div className="field">
        <label>Poste analytique</label>
        <SelectCodeAnalytique valeur={codeAnalytiqueId} codes={codes} onChange={setCodeAnalytiqueId} />
        <span className="muted" style={{ fontSize: 11 }}>
          Il sera repris à chaque sortie : sans lui, la dépense arrive au chantier sans poste.
        </span>
      </div>
      <div className="field">
        <label>Seuil d'alerte (facultatif)</label>
        <input type="number" step="any" min={0} value={seuil} onChange={(e) => setSeuil(e.target.value)}
          style={{ width: 140, textAlign: 'right' }} />
        <span className="muted" style={{ fontSize: 11 }}>
          En dessous, l'article est signalé : un chantier arrêté faute d'un sac coûte plus cher que le sac.
        </span>
      </div>
    </Modale>
  );
}
