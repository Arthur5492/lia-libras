# Contrato: gravações `.npz` e regra das mãos

Fonte da verdade técnica de cada gravação. O Firestore é só um índice. Conferido contra as 291 gravações do bucket em 2026-11-09.

## Caminho no bucket
`<sign_slug>/<uuid>/<NN>.npz`

- `sign_slug`: slug do sinal no catálogo (ex.: `letra-a`). Todas as gravações atuais seguem isso.
- `uuid`: identificador aleatório da pessoa (UUID v4). É o único dado de pessoa no bucket.
- `NN`: índice da gravação com dois dígitos, a partir de `01`.
- O slug de um sinal **não muda** depois que ele tem gravações, porque a pasta não é renomeada. Renomear o sinal altera só `name`.
- Leitores devem aceitar formatos antigos que o código atual ainda trata: pasta com o id em vez do slug e nome sem zero à esquerda (`1.npz`). Nenhum existe hoje. Na migração, vale o `video_path` do manifest.

## Versão 1.0 (todas as gravações atuais)
Abrir sempre com `np.load(..., allow_pickle=False)`.

| Chave | Tipo | Forma | Conteúdo |
|---|---|---|---|
| `schema_version` | str | () | `"1.0"` |
| `sinal_id` | str | () | UUID do sinal no catálogo |
| `video_idx` | int16 | () | Igual ao `NN` do nome |
| `frame_count` | int16 | () | Frames salvos (sempre 30) |
| `raw_frame_count` | int16 | () | Frames capturados antes de reamostrar (varia, ex.: 15 a 35) |
| `duration_ms` | int32 | () | Duração real capturada (2000 a 2151 hoje) |
| `target_fps` | float32 | () | 15 |
| `target_frame_count` | int16 | () | 30 |
| `record_duration_ms` | int32 | () | 2000 |
| `video_width`, `video_height` | int16 | () | Resolução da câmera (640 × 480 hoje) |
| `pose` | float32 | (30, 33, 4) | x, y, z, visibility do BlazePose |
| `pose_mask` | uint8 | (30,) | 1 se havia pose no frame |
| `left_hand`, `right_hand` | float32 | (30, 21, 3) | x, y, z do Hand Landmarker |
| `left_mask`, `right_mask` | uint8 | (30,) | 1 se havia mão naquele canal |

Convenções:
- x e y são normalizados pela imagem **sem espelhar** (o espelho da tela é só visual). x cresce para a direita da imagem da câmera.
- Coordenadas podem sair de [0, 1]: pontos fora do quadro, como as pernas, chegam a y = 2,4.
- `z` é relativo e não deve ser usado como distância real.
- Frame com máscara 0 tem coordenadas zeradas. Nenhum arquivo atual tem NaN.
- Na 1.0, o canal da mão vem do rótulo do detector (`Left`/`Right`). Se as duas mãos recebem o mesmo rótulo, a segunda sobrescreve a primeira, e uma mão se perde.

## Versão 1.1 (gravações novas do PWA)
Mesmas chaves e formas da 1.0, com estas mudanças:
- `schema_version = "1.1"`.
- Os canais já saem pela regra do pulso (abaixo), e nenhuma mão é descartada por rótulo repetido.
- Nova chave `hand_labels`: uint8 (30, 2), com o rótulo original do detector em cada canal (0 = sem mão, 1 = `Left`, 2 = `Right`), só para auditoria.
- Nova chave `capture_version`: str, versão do app que gravou.

Arquivos 1.0 **não são reescritos**, porque o bucket não tem versionamento. A regra do pulso é aplicada também na leitura; em arquivos 1.1 ela não muda nada.

## Regra das mãos (canal pelo pulso da pose)
Usada na leitura de qualquer versão, no treino e na inferência. Python e TypeScript precisam produzir o mesmo resultado nos vetores de teste.

Entradas por frame: pose (com máscara) e até duas mãos detectadas. Canal L = pulso esquerdo da pose (landmark 15); canal R = pulso direito (landmark 16). Distâncias em x e y, coordenadas da imagem, usando o pulso da mão (landmark 0).

Com pose no frame:
1. Uma mão: vai para o canal do pulso mais próximo. Empate vai para L.
2. Duas mãos `a` e `b`: se `d(a,L) + d(b,R) <= d(a,R) + d(b,L)`, então `a → L` e `b → R`; senão, o contrário. As duas nunca caem no mesmo canal.

Sem pose no frame, por continuidade:
1. Para cada canal, guardar a última posição de pulso conhecida.
2. Uma mão: vai para o canal cuja última posição está mais próxima. Sem histórico, mantém o canal que veio no arquivo.
3. Duas mãos: mesma soma mínima do caso com pose, usando as últimas posições. Sem histórico de um dos canais, mantém os canais do arquivo.

"L" e "R" seguem o BlazePose, que nomeia os lados da pessoa. A regra não depende disso estar correto: ela só precisa ser estável.

## Espelhamento (só no treino)
Para ensinar o modelo a aceitar as duas mãos:
- `x' = 1 - x` em pose e mãos.
- Trocar os canais de mão (L ↔ R) e suas máscaras.
- Trocar os pares esquerda/direita da pose: 1↔4, 2↔5, 3↔6, 7↔8, 9↔10, 11↔12, 13↔14, 15↔16, 17↔18, 19↔20, 21↔22, 23↔24, 25↔26, 27↔28, 29↔30, 31↔32.

## Mão ativa
Calculada por gravação, depois da regra do pulso: o canal com mais movimento do pulso, se os dois aparecem em pelo menos metade dos frames; senão, o canal mais presente. Valores: `left`, `right` ou `unknown` (nenhuma mão). É só informação auxiliar: em sinais parados, como as letras U e V, a mão passiva aparece em cerca de 90% dos frames e o resultado é pouco confiável.

## Validação no upload
- Rejeita (não salva): `frame_count != 30`, formas diferentes da tabela, valores não finitos, `sinal_id` fora do catálogo ou inativo, pose em menos de 80% dos frames (`low_pose_rate`) ou alguma mão em menos de 30% (`low_any_hand_rate`).
- Avisa (salva com flag): comparação com o perfil de referência do sinal, como no código atual.

Os perfis de referência atuais usam a chave `amor` (slug), mas as gravações usam o UUID do sinal. Por isso a comparação nunca foi aplicada: nenhuma das 300 linhas de manifest tem flag. Na migração, as chaves dos perfis passam a ser o UUID.
