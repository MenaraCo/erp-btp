'use client';

import { useParams } from 'next/navigation';
import { DevisEditorContent } from './DevisEditorContent';

export default function DevisEditorPage() {
  const params = useParams();
  return (
    <DevisEditorContent
      affaireId={String(params.affaireId)}
      devisId={String(params.devisId)}
    />
  );
}
