'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavItem {
  href: string;
  label: string;
  section: string;
  /** indentation level (0 = top, 1 = sub-item) */
  level?: number;
}

const NAV: NavItem[] = [
  // Module cœur : Études de prix
  { href: '/', label: 'Tableau de bord', section: 'Études de prix' },
  { href: '/estimating/planning', label: 'Planning des études', section: 'Études de prix' },
  { href: '/estimating', label: 'Affaires', section: 'Études de prix' },
  { href: '/estimating/devis', label: 'Devis', section: 'Études de prix' },
  { href: '/estimating/bibliotheque', label: 'Bibliothèque', section: 'Études de prix' },
  { href: '/estimating/bibliotheque/ouvrages', label: 'Ouvrages', section: 'Études de prix', level: 1 },
  { href: '/estimating/bibliotheque/ressources', label: 'Ressources', section: 'Études de prix', level: 1 },
  // Référentiel
  { href: '/clients', label: 'Clients', section: 'Référentiel' },
  { href: '/suppliers', label: 'Fournisseurs', section: 'Référentiel' },
  // Exécution
  { href: '/chantiers', label: 'Chantiers', section: 'Exécution' },
  { href: '/invoicing', label: 'Facturation', section: 'Exécution' },
  // Administration
  { href: '/params', label: 'Paramètres', section: 'Administration' },
];

function isActive(href: string, pathname: string): boolean {
  const base = href.split('#')[0];
  if (base === '/') return pathname === '/';
  // Éditeur de devis : /estimating/{affaireId}/devis/{devisId}
  const isDevisEditor = /^\/estimating\/[^/]+\/devis\/[^/]+/.test(pathname);
  if (base === '/estimating') {
    // Affaires : liste + détail affaire, MAIS pas l'éditeur de devis (→ Devis)
    // ni les sous-routes dédiées (planning, liste devis, bibliothèque).
    return (
      pathname === '/estimating' ||
      (pathname.startsWith('/estimating/') &&
        !isDevisEditor &&
        !pathname.startsWith('/estimating/planning') &&
        !pathname.startsWith('/estimating/devis') &&
        !pathname.startsWith('/estimating/bibliotheque'))
    );
  }
  if (base === '/estimating/devis') {
    // Devis : liste des devis + éditeur d'un devis
    return pathname.startsWith('/estimating/devis') || isDevisEditor;
  }
  return pathname.startsWith(base);
}

export function Sidebar() {
  const pathname = usePathname();
  let lastSection = '';

  return (
    <nav className="sidebar">
      <div className="brand">ERP BTP</div>
      {NAV.map((item) => {
        const showSection = item.section !== lastSection;
        lastSection = item.section;
        const active = isActive(item.href, pathname);
        return (
          <div key={item.href}>
            {showSection && <div className="nav-section">{item.section}</div>}
            <Link
              href={item.href}
              className={active ? 'active' : ''}
              style={item.level ? { paddingLeft: 24, fontSize: 10.5, opacity: 0.85 } : undefined}
            >
              {item.label}
            </Link>
          </div>
        );
      })}
    </nav>
  );
}
