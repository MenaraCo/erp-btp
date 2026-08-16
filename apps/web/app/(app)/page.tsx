'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  FileText, ClipboardCheck, HardHat, Receipt, Gauge, Users, Settings,
  ShoppingCart, Truck, Boxes,
} from 'lucide-react';
import { useCapabilities } from '@/lib/capabilities';
import { AppModule, moduleIsOpen, modulesRacine } from '@/lib/modules';

/**
 * Menu de démarrage — la porte d'entrée de l'application.
 *
 * Une tuile par module. Celles que la société n'a pas souscrites restent VISIBLES mais grisées :
 * les masquer laisserait croire que la fonction n'existe pas, alors qu'elle s'ouvre d'un
 * abonnement. Un clic mène donc à l'écran Abonnement plutôt qu'à un accès refusé.
 *
 * L'habillage (fond, pastilles, relief) est porté par le thème choisi : le balisage est unique,
 * chaque thème le décline (classique, Liquid Glass, iOS 7) via `.tuile` dans son fichier CSS.
 */

// Icône + teinte par module. La teinte colore la pastille façon « icône d'application ».
const DECOR: Record<string, { icon: React.ElementType; tint: string }> = {
  estimating: { icon: FileText, tint: '#007aff' },
  acceptation: { icon: ClipboardCheck, tint: '#34c759' },
  chantiers: { icon: HardHat, tint: '#ff9500' },
  achats: { icon: ShoppingCart, tint: '#0891b2' },
  personnel: { icon: Users, tint: '#4d7c0f' },
  materiel: { icon: Truck, tint: '#b45309' },
  stocks: { icon: Boxes, tint: '#7c3aed' },
  invoicing: { icon: Receipt, tint: '#af52de' },
  direction: { icon: Gauge, tint: '#ff3b30' },
  referentiel: { icon: Users, tint: '#5ac8fa' },
  configuration: { icon: Settings, tint: '#8e8e93' },
};

export default function MenuDemarragePage() {
  const caps = useCapabilities();

  return (
    <div className="menu-demarrage">
      <h1 className="menu-titre">Par où commencer&nbsp;?</h1>
      <p className="menu-sous">Choisissez un module pour ouvrir son espace de travail.</p>

      <div className="grille-tuiles">
        {modulesRacine().map((m) => (
          <Tuile key={m.key} module={m} ouvert={caps.isLoading || moduleIsOpen(m, caps.has)} />
        ))}
      </div>
    </div>
  );
}

function Tuile({ module: m, ouvert }: { module: AppModule; ouvert: boolean }) {
  const router = useRouter();
  const d = DECOR[m.key] ?? { icon: Settings, tint: '#8e8e93' };
  const Icon = d.icon;
  const tint = { '--tint': d.tint } as React.CSSProperties;

  const inner = (
    <>
      <span className="tuile-ico"><Icon size={26} strokeWidth={2} /></span>
      <span className="tuile-txt">
        <span className="tuile-titre">{m.label}</span>
        <span className="tuile-sub">{m.tagline}</span>
      </span>
    </>
  );

  // Grisée : la tuile reste cliquable, mais elle mène à l'offre — pas à un mur.
  if (!ouvert) {
    return (
      <button
        type="button"
        className="tuile tuile-off"
        style={tint}
        title={`${m.label} — module non souscrit`}
        onClick={() => router.push(`/abonnement?decouvrir=${m.key}`)}
      >
        {inner}
        <span className="tuile-badge">Non souscrit</span>
      </button>
    );
  }

  return (
    <Link href={m.home} className="tuile" style={tint} title={m.label}>
      {inner}
    </Link>
  );
}
