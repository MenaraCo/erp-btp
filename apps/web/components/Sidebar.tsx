'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, CalendarDays, FolderOpen, FileText, BookOpen,
  Layers, Package, Users, Truck, Building2, Receipt, Settings, HardHat,
} from 'lucide-react';

interface NavItem {
  href: string;
  label: string;
  section: string;
  level?: number;
}

const NAV: NavItem[] = [
  { href: '/', label: 'Tableau de bord', section: 'Études de prix' },
  { href: '/estimating/planning', label: 'Planning des études', section: 'Études de prix' },
  { href: '/estimating', label: 'Affaires', section: 'Études de prix' },
  { href: '/estimating/devis', label: 'Devis', section: 'Études de prix' },
  { href: '/estimating/bibliotheque', label: 'Bibliothèque', section: 'Études de prix' },
  { href: '/estimating/bibliotheque/ouvrages', label: 'Ouvrages', section: 'Études de prix', level: 1 },
  { href: '/estimating/bibliotheque/ressources', label: 'Ressources', section: 'Études de prix', level: 1 },
  { href: '/clients', label: 'Clients', section: 'Référentiel' },
  { href: '/suppliers', label: 'Fournisseurs', section: 'Référentiel' },
  { href: '/chantiers', label: 'Chantiers', section: 'Exécution' },
  { href: '/invoicing', label: 'Facturation', section: 'Exécution' },
  { href: '/params', label: 'Paramètres', section: 'Administration' },
];

const NAV_ICONS: Record<string, React.ElementType> = {
  '/': LayoutDashboard,
  '/estimating/planning': CalendarDays,
  '/estimating': FolderOpen,
  '/estimating/devis': FileText,
  '/estimating/bibliotheque': BookOpen,
  '/estimating/bibliotheque/ouvrages': Layers,
  '/estimating/bibliotheque/ressources': Package,
  '/clients': Users,
  '/suppliers': Truck,
  '/chantiers': Building2,
  '/invoicing': Receipt,
  '/params': Settings,
};

function isActive(href: string, pathname: string): boolean {
  const base = href.split('#')[0];
  if (base === '/') return pathname === '/';
  const isDevisEditor = /^\/estimating\/[^/]+\/devis\/[^/]+/.test(pathname);
  if (base === '/estimating') {
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
    return pathname.startsWith('/estimating/devis') || isDevisEditor;
  }
  return pathname.startsWith(base);
}

export function Sidebar() {
  const pathname = usePathname();
  let lastSection = '';

  return (
    <nav className="sidebar">
      <div className="brand">
        <div className="brand-logo">
          <HardHat size={17} color="#fff" />
        </div>
        <div>
          <span className="brand-name">ERP BTP</span>
          <span className="brand-sub">Études de prix</span>
        </div>
      </div>
      {NAV.map((item) => {
        const showSection = item.section !== lastSection;
        lastSection = item.section;
        const active = isActive(item.href, pathname);
        const Icon = NAV_ICONS[item.href];
        const iconSize = item.level ? 11 : 13;
        return (
          <div key={item.href}>
            {showSection && <div className="nav-section">{item.section}</div>}
            <Link
              href={item.href}
              className={active ? 'active' : ''}
              style={item.level ? { paddingLeft: 22, fontSize: 10.5, color: active ? 'var(--primary)' : '#64748b' } : undefined}
            >
              {Icon && <Icon size={iconSize} />}
              {item.label}
            </Link>
          </div>
        );
      })}
    </nav>
  );
}
