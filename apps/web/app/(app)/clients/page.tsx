'use client';

import { PartyManager } from '@/components/PartyManager';

export default function ClientsPage() {
  return <PartyManager resource="clients" title="Clients" singular="client" />;
}
