// Consent form shown at registration. Change CONSENT_VERSION each time the text changes.
// The text follows the items of a TCLE in CNS Resolution 510/2016 (art. 17) and the consent rules of
// LGPD (Law 13.709/2018, art. 7, 8 and 18). The text is Portuguese because the participants read it.
// A research ethics committee must approve the final text. The fields in [BRACKETS] are not filled yet.
export const CONSENT_VERSION = "1.0-draft";

export const CONSENT_PARAGRAPHS: string[] = [
  "TERMO DE CONSENTIMENTO LIVRE E ESCLARECIDO",
  "Você está sendo convidado(a) a participar da pesquisa [TÍTULO DA PESQUISA], do projeto Lia Libras, conduzida por [NOME DO(A) PESQUISADOR(A) RESPONSÁVEL] na [INSTITUIÇÃO]. Leia com calma. Você pode recusar ou desistir a qualquer momento, sem nenhum prejuízo.",
  "Objetivo. Reunir gravações de sinais da Língua Brasileira de Sinais (Libras) para estudar e treinar um modelo de computador que reconhece sinais.",
  "O que você vai fazer. Você vai ficar na frente da câmera do seu aparelho e fazer os sinais que o aplicativo pedir. Cada gravação dura poucos segundos.",
  "Quais dados são guardados. O vídeo não sai do seu aparelho e não é guardado. O aplicativo calcula, no próprio aparelho, pontos do corpo e das mãos (coordenadas de articulações) e envia somente esses pontos, o horário relativo de cada quadro e o sinal gravado. Esses pontos não mostram o seu rosto nem a sua imagem. Também guardamos o seu nome de usuário, o seu e-mail de login, o seu nível de participação e a data deste aceite.",
  "Como os dados são usados. Os pontos das gravações podem ser lidos por revisores do projeto e usados para treinar o modelo e para a pesquisa. Uma versão do conjunto de dados, sem o seu nome nem o seu e-mail, pode ser publicada de forma aberta para outros pesquisadores. Cada gravação fica ligada a um código aleatório, e não ao seu nome. Mesmo assim, o jeito de se mover é pessoal, e por isso não podemos garantir anonimato absoluto.",
  "Nome de usuário. Se você aceitar aparecer no ranking, o seu nome de usuário e o número das suas gravações ficam visíveis para outros participantes. Escolha um nome que não revele quem você é, se preferir.",
  "Riscos. Os riscos são pequenos: cansaço ao repetir os sinais, desconforto de ser gravado(a) e a chance, pequena, de alguém ligar os pontos a você. Para reduzir esses riscos, o vídeo não é guardado e o seu e-mail não entra no conjunto de dados.",
  "Benefícios. Você não recebe pagamento. O benefício é indireto: a pesquisa pode ajudar a criar ferramentas de acessibilidade para a comunidade surda.",
  "Seus direitos. A participação é voluntária. Você pode ver e apagar as suas gravações na página “Minhas gravações”. Você também pode pedir o apagamento de todos os seus dados, a correção deles e o fim da sua participação, a qualquer momento, pelo contato abaixo. Gravações que já entraram em uma versão publicada do conjunto de dados podem não poder ser retiradas das cópias que outras pessoas já baixaram.",
  "Base legal. O tratamento dos dados é feito com o seu consentimento (Lei Geral de Proteção de Dados, Lei 13.709/2018) e dentro das regras de pesquisa com seres humanos (Resolução CNS 510/2016).",
  "Contato. Dúvidas ou pedidos: [E-MAIL DO(A) PESQUISADOR(A)]. Comitê de Ética em Pesquisa: [NOME, TELEFONE E E-MAIL DO CEP]. Número de aprovação: [NÚMERO CAAE].",
  "Ao marcar a caixa abaixo, você declara que leu este termo, que entendeu as informações e que aceita participar de forma voluntária. Guarde uma cópia: o texto desta versão fica registrado no projeto.",
];
