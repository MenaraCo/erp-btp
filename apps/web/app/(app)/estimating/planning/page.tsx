'use client';

export default function PlanningEtudesPage() {
  return (
    <div>
      <h1>Planning des études</h1>
      <p className="muted" style={{ marginTop: 0 }}>Suivi de la charge du bureau d’études.</p>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="form-section-title">À venir</div>
        <p className="muted">
          Vues <strong>Gantt</strong>, <strong>Calendrier</strong> et <strong>Charge</strong> par
          responsable — avec dates, priorités et affectation des devis en étude. Nécessite l’ajout
          des champs <em>responsable</em>, <em>priorité</em> et <em>échéances</em> sur le devis.
        </p>
      </div>
    </div>
  );
}
