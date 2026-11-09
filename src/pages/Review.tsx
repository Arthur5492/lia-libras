import { canReview, useProfile } from "../auth";

export function Review() {
  const profile = useProfile();

  if (!canReview(profile)) {
    return (
      <main className="page">
        <h1>Analisar</h1>
        <p>
          A análise confere se cada gravação mostra o sinal certo. Ela é feita por pessoas com nível de confiança
          mais alto, definido pela equipe do projeto.
        </p>
        <p className="note">Seu nível atual é regular. Suas gravações continuam valendo normalmente.</p>
      </main>
    );
  }

  return (
    <main className="page">
      <h1>Analisar</h1>
      <p className="note">A fila de gravações para analisar chega em uma próxima versão.</p>
    </main>
  );
}
