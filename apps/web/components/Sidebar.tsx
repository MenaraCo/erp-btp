'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, CalendarDays, FolderOpen, FileText, BookOpen,
  Layers, Package, Users, Truck, Building2, Receipt, Settings, HardHat,
  CreditCard, Gauge, ChevronsLeft, ChevronsRight, UserCog, Upload,
} from 'lucide-react';

const STORAGE_KEY = 'erp-sidebar-collapsed';

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
  { href: '/estimating/imports', label: 'Imports', section: 'Études de prix' },
  { href: '/clients', label: 'Clients', section: 'Référentiel' },
  { href: '/suppliers', label: 'Fournisseurs', section: 'Référentiel' },
  { href: '/direction', label: 'Direction', section: 'Exécution' },
  { href: '/chantiers', label: 'Chantiers', section: 'Exécution' },
  { href: '/invoicing', label: 'Facturation', section: 'Exécution' },
  { href: '/params', label: 'Paramètres', section: 'Administration' },
  { href: '/users', label: 'Utilisateurs', section: 'Administration' },
  { href: '/abonnement', label: 'Abonnement', section: 'Administration' },
];

const NAV_ICONS: Record<string, React.ElementType> = {
  '/': LayoutDashboard,
  '/estimating/planning': CalendarDays,
  '/estimating': FolderOpen,
  '/estimating/devis': FileText,
  '/estimating/bibliotheque': BookOpen,
  '/estimating/bibliotheque/ouvrages': Layers,
  '/estimating/bibliotheque/ressources': Package,
  '/estimating/imports': Upload,
  '/clients': Users,
  '/suppliers': Truck,
  '/direction': Gauge,
  '/chantiers': Building2,
  '/invoicing': Receipt,
  '/params': Settings,
  '/users': UserCog,
  '/abonnement': CreditCard,
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
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'true') setCollapsed(true);
  }, []);

  useEffect(() => {
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    localStorage.setItem(STORAGE_KEY, String(collapsed));
  }, [collapsed]);

  let lastSection = '';

  return (
    <nav className="sidebar">
      {/* Brand */}
      <div className="brand">
        <div className="brand-logo">
          <HardHat size={17} color="#fff" />
        </div>
        <div className="brand-text">
          <span className="brand-name">ERP BTP</span>
          <span className="brand-sub">Études de prix</span>
        </div>
      </div>

      {/* Nav items — sub-items hidden in collapsed mode */}
      {NAV.map((item) => {
        const showSection = item.section !== lastSection;
        lastSection = item.section;
        const active = isActive(item.href, pathname);
        const Icon = NAV_ICONS[item.href];
        const iconSize = item.level ? 11 : 13;
        return (
          <div key={item.href} className={item.level ? 'nav-sub' : ''}>
            {showSection && <div className="nav-section">{item.section}</div>}
            <Link
              href={item.href}
              className={active ? 'active' : ''}
              title={item.label}
              style={item.level ? { paddingLeft: 22, fontSize: 10.5, color: active ? 'var(--primary)' : '#64748b' } : undefined}
            >
              {Icon && <Icon size={iconSize} />}
              <span className="nav-label">{item.label}</span>
            </Link>
          </div>
        );
      })}

      {/* Collapse toggle */}
      <button
        type="button"
        className="sidebar-toggle"
        onClick={() => setCollapsed((v) => !v)}
        title={collapsed ? 'Agrandir le menu' : 'Réduire le menu'}
      >
        {collapsed ? <ChevronsRight size={14} /> : <ChevronsLeft size={14} />}
        <span className="nav-label">Réduire</span>
      </button>
    </nav>
  );
}
