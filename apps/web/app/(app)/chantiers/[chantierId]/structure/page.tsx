import { redirect } from 'next/navigation';

/**
 * Ancienne adresse de « Structure & budget », scindée en trois écrans (Étude d'exécution,
 * Budgets, Avancement constaté). Un onglet resté ouvert ou un favori ne doit pas tomber sur une
 * page introuvable : on renvoie sur l'étude, d'où partent les deux autres.
 */
export default async function StructureRedirect({
  params,
}: {
  params: Promise<{ chantierId: string }>;
}) {
  const { chantierId } = await params;
  redirect(`/chantiers/${chantierId}/etude`);
}
