'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarRange, ClipboardCheck, Plus, ShoppingCart, Trash2, Truck } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { euro } from '@/lib/format';
import { Alerte, Badge, Bouton, CarteKpi, LigneVide } from '@/components/ui';
import { Modale } from '@/components/Modale';
import { Materiel } from '@/components/MaterielModal';
import { CodeAnalytique, SelectCodeAnalytique } from '@/components/SelectCodeAnalytique';

interface Affectation {
  id: string;
  equipment_id: string;
  date_debut: string;
  date_fin: string;
  materiel_code: string;
  materiel: string;
  unite_cout: 'heure' | 'jour';
  cout_unitaire: string;
  commentaire: string | null;
}
interface Utilisation {
  id: string;
  equipment_id: string;
  work_date: string;
  quantite: string;
  cout_unitaire: string;
  cout: string;
  materiel_code: string;
  materiel: string;
  unite_cout: 'heure' | 'jour';
  ouvrage_label: string | null;
  code_analytique: string | null;
  commentaire: string | null;
}
interface LigneExecution { id: string; type: string; code: string | null; designation: string | null }
interface Resultats {
  byNature: Array<{ nature: string; engage: string; realise: string; budgetObjectif: string }>;
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function jour(v: string | null): string {
  return v ? new Date(v).toLocaleDateString('fr-FR') : '—';
}

/**
 * Matériel DU chantier — réserver, louer, et relever ce qui a servi.
 *
 * On sait de quelle machine on a besoin depuis le chantier, pas depuis le dépôt : la réservation
 * part donc d'ici. Réserver, c'est de l'ENGAGÉ — la machine est promise, elle compte avant même
 * d'avoir tourné. Le relevé, lui, constate ce qui a réellement travaillé : c'est le réalisé, et
 * c'est ce que le chantier paie.
 *
 * Un engin de location porte son loueur : la réservation ne remplace pas la commande, elle la
 * prépare — d'où le renvoi vers les achats du chantier.
 */
export default function MaterielChantierPage() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const chantierId = String(useParams().chantierId);
  const [err, setErr] = useState<string | null>(null);
  const [reservation, setReservation] = useState<null | {
    equipmentId: string; dateDebut: string; dateFin: string;
  }>(null);
  const [releve, setReleve] = useState<null | {
    equipmentId: string; date: string; quantite: string; coutUnitaire: string;
    executionLineId: string; codeAnalytiqueId: string | null;
  }>(null);

  const chantier = useQuery({
    queryKey: ['chantier', chantierId],
    enabled: Boolean(token),
    queryFn: () => apiFetch<{ code: string }>(`/chantiers/${chantierId}`, { token }),
  });
  const parc = useQuery({
    queryKey: ['materiel', false],
    enabled: Boolean(token), retry: false,
    queryFn: () => apiFetch<Materiel[]>('/materiel', { token }),
  });
  // Période large : un chantier réserve des mois à l'avance, et on veut aussi voir le passé.
  const affectations = useQuery({
    queryKey: ['materiel-affectations-chantier', chantierId],
    enabled: Boolean(token), retry: false,
    queryFn: () => apiFetch<Affectation[]>(
      `/materiel/affectations?debut=2000-01-01&fin=2100-12-31&chantier=${chantierId}`, { token },
    ),
  });
  const utilisations = useQuery({
    queryKey: ['materiel-utilisations-chantier', chantierId],
    enabled: Boolean(token), retry: false,
    queryFn: () => apiFetch<Utilisation[]>(`/materiel/utilisations?chantier=${chantierId}`, { token }),
  });
  const resultats = useQuery({
    queryKey: ['chantier-results', chantierId],
    enabled: Boolean(token), retry: false,
    queryFn: () => apiFetch<Resultats>(`/chantiers/${chantierId}/results`, { token }),
  });
  const arbre = useQuery({
    queryKey: ['execution-tree', chantierId],
    enabled: Boolean(token), retry: false,
    queryFn: () => apiFetch<{ lines: LigneExecution[] }>(`/chantiers/${chantierId}/execution-tree`, { token }),
  });
  const codes = useQuery({
    queryKey: ['params-codes'], enabled: Boolean(token), retry: false,
    queryFn: () => apiFetch<CodeAnalytique[]>('/params/codes', { token }),
  });

  const rafraichir = () => {
    for (const key of ['materiel-affectations-chantier', 'materiel-utilisations-chantier',
      'materiel-affectations', 'chantier-results', 'materiel', 'chantier-analytical']) {
      qc.invalidateQueries({ queryKey: [key] });
    }
  };
  const echoue = (e: unknown) => setErr(e instanceof ApiError ? e.message : 'Opération impossible.');

  const reserver = useMutation({
    mutationFn: () => apiFetch(`/materiel/${reservation?.equipmentId}/affectations`, {
      method: 'POST', token,
      body: {
        chantierId, dateDebut: reservation?.dateDebut, dateFin: reservation?.dateFin,
      },
    }),
    onSuccess: () => { setErr(null); setReservation(null); rafraichir(); },
    onError: echoue,
  });
  const liberer = useMutation({
    mutationFn: (id: string) => apiFetch(`/materiel/affectations/${id}`, { method: 'DELETE', token }),
    onSuccess: () => { setErr(null); rafraichir(); },
    onError: echoue,
  });
  const relever = useMutation({
    mutationFn: () => apiFetch(`/materiel/${releve?.equipmentId}/utilisations`, {
      method: 'POST', token,
      body: {
        chantierId,
        date: releve?.date,
        quantite: releve?.quantite || '0',
        coutUnitaire: releve?.coutUnitaire || null,
        executionLineId: releve?.executionLineId || null,
        codeAnalytiqueId: releve?.codeAnalytiqueId,
      },
    }),
    onSuccess: () => { setErr(null); setReleve(null); rafraichir(); },
    onError: echoue,
  });
  const supprimerReleve = useMutation({
    mutationFn: (id: string) => apiFetch(`/materiel/utilisations/${id}`, { method: 'DELETE', token }),
    onSuccess: () => { setErr(null); rafraichir(); },
    onError: echoue,
  });

  const materielNature = resultats.data?.byNature.find((n) => n.nature === 'equipment');
  const ouvrages = (arbre.data?.lines ?? []).filter((l) => l.type === 'ouvrage');
  const parcParId = useMemo(
    () => new Map((parc.data ?? []).map((m) => [m.id, m])),
    [parc.data],
  );
  const enLocation = (affectations.data ?? [])
    .map((a) => parcParId.get(a.equipment_id))
    .filter((m): m is Materiel => Boolean(m) && m!.propriete === 'location');

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        <Link href={`/chantiers/${chantierId}`} className="link">← Chantier {chantier.data?.code ?? ''}</Link>
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Truck size={20} /> Matériel du chantier
        </h1>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Bouton
            variante="secondaire"
            icone={ClipboardCheck}
            disabled={!parc.data?.length}
            onClick={() => setReleve({
              equipmentId: affectations.data?.[0]?.equipment_id ?? parc.data?.[0]?.id ?? '',
              date: iso(new Date()),
              quantite: '1',
              coutUnitaire: '',
              executionLineId: '',
              codeAnalytiqueId: null,
            })}
          >
            Relever une utilisation
          </Bouton>
          <Bouton
            icone={Plus}
            disabled={!parc.data?.length}
            onClick={() => setReservation({
              equipmentId: parc.data?.[0]?.id ?? '',
              dateDebut: iso(new Date()),
              dateFin: iso(new Date()),
            })}
          >
            Réserver un matériel
          </Bouton>
        </span>
      </div>
      <p className="muted" style={{ marginTop: 4, maxWidth: 820 }}>
        Réserver, c’est <strong>engager</strong> : la machine est promise à ce chantier et compte
        avant d’avoir tourné. Relever, c’est constater ce qui a réellement travaillé — et c’est ce
        que le chantier paie.
      </p>

      {err && <Alerte>{err}</Alerte>}
      {enLocation.length > 0 && (
        <Alerte ton="info">
          <ShoppingCart size={13} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          {enLocation.length} matériel{enLocation.length > 1 ? 's' : ''} de location réservé
          {enLocation.length > 1 ? 's' : ''} ({enLocation.map((m) => m.code).join(', ')}) : la
          réservation ne vaut pas commande.{' '}
          <Link href={`/chantiers/${chantierId}/achats`} className="link">
            Passer la commande de location →
          </Link>
        </Alerte>
      )}

      <div className="card-grid" style={{ marginTop: 14 }}>
        <CarteKpi
          titre="Matériel engagé"
          valeur={euro(materielNature?.engage ?? '0')}
          detail="journées réservées non encore relevées"
        />
        <CarteKpi
          titre="Matériel réalisé"
          valeur={euro(materielNature?.realise ?? '0')}
          detail={`${(utilisations.data ?? []).length} relevé${(utilisations.data ?? []).length > 1 ? 's' : ''}`}
        />
        <CarteKpi
          titre="Budget matériel"
          valeur={euro(materielNature?.budgetObjectif ?? '0')}
          ton={Number(materielNature?.realise ?? 0) + Number(materielNature?.engage ?? 0)
            > Number(materielNature?.budgetObjectif ?? 0) ? 'danger' : undefined}
        />
        <CarteKpi titre="Réservations" valeur={(affectations.data ?? []).length} />
      </div>

      <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
          <CalendarRange size={15} /><strong style={{ fontSize: 13 }}>Réservations</strong>
          <Link href="/materiel/planning" className="link" style={{ marginLeft: 'auto', fontSize: 12 }}>
            Planning du parc →
          </Link>
        </div>
        <table className="grid" style={{ margin: 0 }}>
          <thead>
            <tr>
              <th style={{ width: 100 }}>Code</th>
              <th>Matériel</th>
              <th style={{ width: 110 }}>Du</th>
              <th style={{ width: 110 }}>Au</th>
              <th style={{ width: 130, textAlign: 'right' }}>Coût utilisation</th>
              <th style={{ width: 110 }}>Propriété</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {(affectations.data ?? []).map((a) => {
              const m = parcParId.get(a.equipment_id);
              return (
                <tr key={a.id}>
                  <td className="code-cell">{a.materiel_code}</td>
                  <td>{a.materiel}</td>
                  <td className="muted">{jour(a.date_debut)}</td>
                  <td className="muted">{jour(a.date_fin)}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {euro(a.cout_unitaire)}
                    <span className="muted" style={{ fontSize: 11 }}>
                      {a.unite_cout === 'jour' ? ' / j' : ' / h'}
                    </span>
                  </td>
                  <td>
                    {m?.propriete === 'location'
                      ? <Badge ton="attention">Location{m.fournisseur ? ` · ${m.fournisseur}` : ''}</Badge>
                      : <span className="muted">Parc</span>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn-ghost" title="Libérer le matériel" onClick={() => liberer.mutate(a.id)}>
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              );
            })}
            {affectations.data && affectations.data.length === 0 && (
              <LigneVide
                colonnes={7}
                icone={CalendarRange}
                titre="Aucun matériel réservé pour ce chantier."
                indice="« Réserver un matériel » bloque l’engin sur la période : il ne pourra pas être promis ailleurs."
              />
            )}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
          <ClipboardCheck size={15} /><strong style={{ fontSize: 13 }}>Utilisation relevée</strong>
        </div>
        <table className="grid" style={{ margin: 0 }}>
          <thead>
            <tr>
              <th style={{ width: 110 }}>Date</th>
              <th style={{ width: 100 }}>Code</th>
              <th>Matériel</th>
              <th>Ouvrage</th>
              <th style={{ width: 90 }}>Poste</th>
              <th style={{ width: 90, textAlign: 'right' }}>Quantité</th>
              <th style={{ width: 110, textAlign: 'right' }}>Coût</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {(utilisations.data ?? []).map((u) => (
              <tr key={u.id}>
                <td className="code-cell">{jour(u.work_date)}</td>
                <td className="code-cell">{u.materiel_code}</td>
                <td>{u.materiel}</td>
                <td className="muted">{u.ouvrage_label ?? '—'}</td>
                <td>{u.code_analytique
                  ? <span className="code-cell">{u.code_analytique}</span>
                  : <Badge ton="attention">—</Badge>}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {Number(u.quantite).toLocaleString('fr-FR')}
                  <span className="muted" style={{ fontSize: 11 }}>
                    {u.unite_cout === 'jour' ? ' j' : ' h'}
                  </span>
                </td>
                <td style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {euro(u.cout)}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button className="btn-ghost" title="Supprimer ce relevé" onClick={() => supprimerReleve.mutate(u.id)}>
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
            {utilisations.data && utilisations.data.length === 0 && (
              <LigneVide
                colonnes={8}
                icone={ClipboardCheck}
                titre="Aucune utilisation relevée."
                indice="Tant que rien n’est relevé, le matériel reste en engagé : il est promis, mais le chantier ne l’a pas encore payé."
              />
            )}
          </tbody>
        </table>
      </div>

      {reservation && (
        <Modale
          titre="Réserver un matériel"
          sousTitre="Un engin déjà promis ailleurs sur ces dates sera refusé, avec le chantier en cause."
          largeur="s"
          onClose={() => setReservation(null)}
          actions={(
            <Bouton
              chargement={reserver.isPending}
              disabled={!reservation.equipmentId}
              onClick={() => { setErr(null); reserver.mutate(); }}
            >
              Réserver
            </Bouton>
          )}
        >
          <div className="field">
            <label>Matériel</label>
            <select
              value={reservation.equipmentId}
              onChange={(e) => setReservation({ ...reservation, equipmentId: e.target.value })}
            >
              {(parc.data ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.code} — {m.label}
                  {m.propriete === 'location' ? ' (location)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Du</label>
              <input
                type="date" value={reservation.dateDebut}
                onChange={(e) => setReservation({ ...reservation, dateDebut: e.target.value })}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Au</label>
              <input
                type="date" value={reservation.dateFin}
                onChange={(e) => setReservation({ ...reservation, dateFin: e.target.value })}
              />
            </div>
          </div>
        </Modale>
      )}

      {releve && (
        <Modale
          titre="Relever une utilisation"
          sousTitre="Ce qui est relevé quitte l’engagé et devient du réalisé : c’est la dépense du chantier."
          largeur="m"
          onClose={() => setReleve(null)}
          actions={(
            <Bouton
              chargement={relever.isPending}
              disabled={!releve.equipmentId || !releve.date}
              onClick={() => { setErr(null); relever.mutate(); }}
            >
              Enregistrer
            </Bouton>
          )}
        >
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div className="field" style={{ marginBottom: 0, flex: 1, minWidth: 220 }}>
              <label>Matériel</label>
              <select
                value={releve.equipmentId}
                onChange={(e) => setReleve({ ...releve, equipmentId: e.target.value, coutUnitaire: '' })}
              >
                {(parc.data ?? []).map((m) => (
                  <option key={m.id} value={m.id}>{m.code} — {m.label}</option>
                ))}
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0, width: 150 }}>
              <label>Date</label>
              <input
                type="date" value={releve.date}
                onChange={(e) => setReleve({ ...releve, date: e.target.value })}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10, alignItems: 'flex-end' }}>
            <div className="field" style={{ marginBottom: 0, width: 130 }}>
              <label>
                Quantité ({parcParId.get(releve.equipmentId)?.unite_cout === 'heure' ? 'heures' : 'journées'})
              </label>
              <input
                type="number" step="0.25" style={{ textAlign: 'right' }}
                value={releve.quantite}
                onChange={(e) => setReleve({ ...releve, quantite: e.target.value })}
              />
            </div>
            <div className="field" style={{ marginBottom: 0, width: 150 }}>
              <label>Coût unitaire (€)</label>
              <input
                type="number" step="0.01" style={{ textAlign: 'right' }}
                placeholder={String(Number(parcParId.get(releve.equipmentId)?.cout_unitaire ?? 0))}
                value={releve.coutUnitaire}
                onChange={(e) => setReleve({ ...releve, coutUnitaire: e.target.value })}
              />
              <span className="muted" style={{ fontSize: 11 }}>Vide, celui de la fiche s’applique.</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
            <div className="field" style={{ marginBottom: 0, flex: 1, minWidth: 220 }}>
              <label>Ouvrage (facultatif)</label>
              <select
                value={releve.executionLineId}
                onChange={(e) => setReleve({ ...releve, executionLineId: e.target.value })}
              >
                <option value="">— Non rattaché —</option>
                {ouvrages.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.code ? `${o.code} · ` : ''}{o.designation ?? ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0, width: 160 }}>
              <label>Code analytique</label>
              <SelectCodeAnalytique
                valeur={releve.codeAnalytiqueId}
                codes={codes.data ?? []}
                onChange={(id) => setReleve({ ...releve, codeAnalytiqueId: id })}
              />
              <span className="muted" style={{ fontSize: 11 }}>Vide, celui de la fiche s’applique.</span>
            </div>
          </div>
        </Modale>
      )}
    </div>
  );
}
