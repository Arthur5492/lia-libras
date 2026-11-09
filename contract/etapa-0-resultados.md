# Etapa 0: resultados dos testes de risco

Data: 2026-11-09. Scripts em `scripts/analysis/` e `training/tools/`.

## Resumo

| Risco | Resultado | Decisão |
|---|---|---|
| Rótulos de mão | Não estão trocados de forma sistemática; 2,2% divergem da pose | Separar as mãos pelo pulso da pose |
| Bucket no navegador | Funciona pela URL `resolve`; o gateway S3 recusa acesso anônimo | Baixar dados públicos por `resolve` |
| Exportação do modelo | TensorFlow.js funciona e preserva as previsões | Usar TensorFlow.js; ONNX não é necessário |
| API em Python | Cabe no limite de tamanho; pouca CPU por upload | Manter Python; medir no Vercel |
| Bucket público | Já é público, com `users.csv` exposto | Mantido como está, por decisão do responsável |
| Vercel real | Não testado; depende da conta | Pendente |
| Celulares simples | Não testado; depende de aparelhos | Pendente |

## Dataset real em 2026-11-09
291 gravações, 8 pessoas, 29 sinais, sempre 30 frames, cerca de 26 KB por `.npz`. A distribuição é desigual: as gravações por pessoa são 120, 62, 33, 30, 24, 10, 8 e 4. Isso é pouco para um modelo geral e para separar por pessoa com folga.

## Mãos
Com 14.240 ocorrências de mão em 8.730 frames (todos com pose):

| Medida | Valor |
|---|---|
| Rótulo coincide com o pulso mais próximo | 13.927 (97,8%) |
| Rótulo diverge do pulso | 313 (2,2%), em 106 gravações (36%) |
| Duas mãos mais próximas do mesmo pulso | 50 frames |
| Mesma mão saltando de canal | 21 vezes, em 17 gravações |
| Mão a mais de 1 largura de ombro de qualquer pulso | 127 (0,89%) |

Sem gabarito, o critério foi físico: uma mão não salta longe entre dois frames seguidos.

| Salto entre frames | Rótulo do detector | Pulso da pose |
|---|---|---|
| Mais de 0,5 largura de ombro | 188 saltos, em 92 gravações | 19 saltos, em 12 gravações |
| Mais de 1,0 largura de ombro | 172 saltos, em 84 gravações | 13 saltos, em 7 gravações |

**Regra adotada:** com uma mão, vai para o canal do pulso mais próximo; com duas, usa a combinação de menor distância total, o que impede duas mãos no mesmo canal.

**Limites do teste:**
- Não mede mãos perdidas quando o detector dá o mesmo rótulo às duas, porque a segunda não é salva (`recorder.js:1104-1105`). A captura nova deve guardar ambas.
- O caso de frames sem pose não aparece nestes dados.
- O teste não diz qual método acertou em cada frame, só qual é mais estável.

**Mão ativa:** as 8 pessoas têm gravações com os dois lados, e 22 de 29 sinais aparecem com os dois lados. A medida é só um indício: a heurística é pouco confiável em sinais parados, e letras como U e V mostram duas mãos em cerca de 90% dos frames, ou seja, a mão passiva costuma estar visível. `active_hand` não deve ser tratada como verdade em sinais estáticos.

## Bucket
- `private: false` na API do Hub. A listagem e os arquivos respondem sem autenticação.
- `https://huggingface.co/buckets/<dono>/<bucket>/resolve/<arquivo>` redireciona ao CDN, e os dois respondem com CORS que permite o navegador. Testado com `curl` e o cabeçalho `Origin`; falta repetir em um navegador real.
- Em 2026-11-09 o responsável decidiu manter o bucket público, com `users.csv`, até a migração (etapa 9) remover os CSVs.
- `https://s3.hf.co/...` responde 403 sem credenciais. O gateway serve para escrita pela API, não para leitura anônima.

## Exportação do modelo
`lstm_libras/models/v2/model.h5` (entrada 20 × 196, 10 classes) foi convertido para `model.json` + pesos, com cerca de 327 KB no total.

| Comparação com o Keras 2.10 | Resultado |
|---|---|
| Amostras com a mesma classe | 8 de 8, incluindo uma toda em zeros |
| Maior diferença de probabilidade | 4,47e-8 |
| Tempo por inferência, JS puro em PC | 12 ms (no celular será maior; falta medir) |

Ambiente de conversão, separado do treino: Python 3.11, `tensorflowjs==4.22.0`, `tf-keras`, `setuptools<81`. No Windows, o conversor falha ao importar `tensorflow_decision_forests`; `training/tools/convert_h5.py` contorna isso e não usa essa parte.

## API em Python
Medido localmente, com pacotes Linux. Não substitui a medição no Vercel.

| Medida | Valor |
|---|---|
| Pacotes com `numpy`, `fastapi`, `firebase-admin`, `huggingface_hub` e `boto3` | 165 MB (140 MB sem `boto3`), contra o limite de 500 MB |
| Corpo JSON de uma gravação de 30 frames | 124 KB |
| CPU para ler o JSON e gerar o `.npz` | cerca de 10 ms, sem contar rede e início a frio |
| Importações, na segunda execução | `firebase_admin` cerca de 1,8 s; `fastapi` cerca de 1,2 s; `numpy` cerca de 0,8 s (medições sobrepostas, no Windows) |

O início a frio é o custo a observar: com a cota de 4 h de CPU por mês, ele pesa mais que o processamento do upload.

## Pendente
1. Publicar um teste no Vercel e medir o início a frio e a CPU reais.
2. Medir fps do MediaPipe e da inferência em celular simples e no iOS.
