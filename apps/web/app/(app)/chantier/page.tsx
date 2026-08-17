'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { HardHat, ShoppingCart, Users, Truck, Boxes } from 'lucide-react';
import { useCapabilities } from '@/lib/capabilities';
import { moduleIsOpen, sousModules, MODULES } from '@/lib/modules';

interface Tuile {
  key: string;
  label: string;
  tagline: string;
  href: string | null;
  icon: React.ElementType;
  tint: string;
  ouvert: boolean;
  /** Fonction annoncée mais pas encore construite : dite comme telle, jamais un lien mort. */
  aVenir?: boolean;
}

const DECOR: Record<string, { icon: React.ElementType; tint: string }> = {
  chantiers: { icon: HardHat, tint: '#ff9500' },
  achats: { icon: ShoppingCart, tint: '#0891b2' },
  personnel: { icon: Users, tint: '#4d7c0f' },
  materiel: { icon: Truck, tint: '#b45309' },
};

/**
 * Espace Chantier — la porte d'entrée de tout ce qui se passe sur le terrain.
 *
 * Les achats, le personnel, le matériel et les stocks sont des métiers DU chantier : ils méritent
 * chacun leur espace (on ne travaille pas cinquante commandes chantier par chantier), mais ils
 * n'ont pas à s'aligner dans le menu de démarrage à côté de l'Étude de prix. On entre donc par le
 * chantier, puis on choisit son métier — et chacun reste par ailleurs accessible DANS un chantier
 * ouvert, via son menu contextuel.
 */
export default function EspaceChantierPage() {
  const caps = useCapabilities();
  const ouvertParDefaut = caps.isLoading;
  const chantiers = MODULES.find((m) => m.key === 'chantiers')!;

  const tuiles: Tuile[] = [
    {
      key: 'chantiers',
      label: 'Chantiers',
      tagline: 'Budgets, avancement, résultats et pilotage',
      href: '/chantiers',
      ...DECOR.chantiers,
      ouvert: ouvertParDefaut || moduleIsOpen(chantiers, caps.has),
    },
    ...sousModules('chantiers').map((m) => ({
      key: m.key,
      label: m.label,
      tagline: m.tagline,
      href: m.home,
      ...(DECOR[m.key] ?? { icon: HardHat, tint: '#8e8e93' }),
      ouvert: ouvertParDefaut || moduleIsOpen(m, caps.has),
    })),
    {
      key: 'stocks',
      label: 'Stocks',
      tagline: 'Dépôt, entrées et sorties de matériaux',
      href: null,
      icon: Boxes,
      tint: '#7c3aed',
      ouvert: false,
      aVenir: true,
    },
  ];

  return (
    <div className="menu-demarrage">
      <h1 className="menu-titre">Chantier</h1>
      <p className="menu-sous">
        Le terrain, par métier. Chacun reste aussi accessible depuis un chantier ouvert.
      </p>

      <div className="grille-tuiles">
        {tuiles.map((t) => <TuileEspace key={t.key} tuile={t} />)}
      </div>
    </div>
  );
}

function TuileEspace({ tuile }: { tuile: Tuile }) {
  const router = useRouter();
  const Icon = tuile.icon;
  const tint = { '--tint': tuile.tint } as React.CSSProperties;

  const inner = (
    <>
      <span className="tuile-ico"><Icon size={26} strokeWidth={2} /></span>
      <span className="tuile-txt">
        <span className="tuile-titre">{tuile.label}</span>
        <span className="tuile-sub">{tuile.tagline}</span>
      </span>
    </>
  );

  // À venir : la tuile annonce ce qui existera, sans promettre un écran qui n'est pas là.
  if (tuile.aVenir) {
    return (
      <div className="tuile tuile-off" style={{ ...tint, cursor: 'default' }} title={`${tuile.label} — à venir`}>
        {inner}
        <span className="tuile-badge">À venir</span>
      </div>
    );
  }

  if (!tuile.ouvert) {
    return (
      <button
        type="button"
        className="tuile tuile-off"
        style={tint}
        title={`${tuile.label} — module non souscrit`}
        onClick={() => router.push(`/abonnement?decouvrir=${tuile.key}`)}
      >
        {inner}
        <span className="tuile-badge">Non souscrit</span>
      </button>
    );
  }

  return (
    <Link href={tuile.href ?? '/'} className="tuile" style={tint} title={tuile.label}>
      {inner}
    </Link>
  );
}
