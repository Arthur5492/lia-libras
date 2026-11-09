# Contrato: esquema do Firestore

O Firestore guarda pessoas e metadados. Os `.npz` ficam no bucket (ver [npz.md](npz.md)).

## Princípios
- **Toda escrita passa pela API**, com o Admin SDK. O navegador só lê o próprio perfil (`firestore.rules`).
- **Nada de dado pessoal no bucket.** O e-mail fica só no Firebase Auth e não é copiado para o Firestore.
- **Datas** são `timestamp` do Firestore, em UTC.
- **Dados repetidos de propósito**, porque não há `JOIN`: o `user_trust_level` vai em cada gravação; mudar o nível de alguém atualiza as gravações dela em lote.
- **Contadores** são atualizados na mesma transação da escrita, para evitar contar documentos e gastar a cota.

## `users/{uid}`
`uid` é o do Firebase Auth.

| Campo | Tipo | Notas |
|---|---|---|
| `uuid` | string | UUID v4 do dataset, imutável. Contas antigas vinculadas recebem o uuid antigo |
| `username` | string | Como a pessoa digitou |
| `username_key` | string | Forma normalizada, chave de `usernames` |
| `role` | `user` \| `admin` | `admin` gerencia usuários e catálogo |
| `trust_level` | `regular` \| `trusted` \| `expert` | Só admin altera |
| `show_in_ranking` | bool | Padrão `false` |
| `consent_version` | string | Versão do termo aceito |
| `consent_at` | timestamp | |
| `recording_count` | int | Gravações não apagadas |
| `sign_recordings` | map | `{sign_id: [índices]}`, para escolher o próximo índice sem ler gravações. Fora dos índices de busca |
| `legacy_hf_username` | string, opcional | Só em contas vinculadas |
| `created_at`, `updated_at` | timestamp | |

## `usernames/{username_key}`
Reserva de nome único, criada na mesma transação do perfil.

| Campo | Tipo | Notas |
|---|---|---|
| `uid` | string \| null | Dono atual |
| `legacy_uuid` | string, opcional | Nome reservado de conta antiga ainda não vinculada |
| `created_at` | timestamp | |

Regras do nome: 3 a 20 caracteres, letras, números e `_`. `username_key` = minúsculas, sem acentos. Nomes reservados (como `admin`) ficam no código; termos ofensivos ficam em `config/username_blocklist.terms` e bloqueiam qualquer username que os contenha.

## `legacy_users/{uuid}`
Contas do app antigo (login HF), importadas de `users.csv`.

| Campo | Tipo |
|---|---|
| `hf_username`, `handedness`, `trust_level` | string |
| `first_seen` | timestamp |
| `recording_count` | int |
| `linked_uid` | string \| null |

Vincular uma conta: o admin escolhe a conta antiga, `users/{uid}.uuid` recebe o uuid dela, `trust_level` é copiado e `linked_uid` é preenchido. As gravações continuam ligadas pelo `uuid`, sem mudar nada no bucket.

## `signs/{sign_id}`
`sign_id` é o UUID do catálogo atual.

| Campo | Tipo | Notas |
|---|---|---|
| `slug` | string | Nome da pasta no bucket; imutável depois da primeira gravação |
| `name` | string | Nome exibido |
| `video_url` | string | Vídeo de referência (INES) |
| `metadata` | map | Segue `config/sign_catalog.sign_metadata_schema` (hoje `is_dynamic`, `is_two_handed`) |
| `active` | bool | Inativo some da coleta, mas mantém as gravações |
| `order` | int | Ordem na coleta |
| `recording_count`, `accepted_count`, `reference_count` | int | Contadores |
| `created_at`, `updated_at` | timestamp | |

## `recordings/{uuid}_{sign_id}_{NN}`
ID fixo: reenviar a mesma gravação não cria outro documento.

| Campo | Tipo | Notas |
|---|---|---|
| `uuid`, `sign_id`, `sign_slug` | string | |
| `video_idx` | int | |
| `path` | string | Caminho no bucket, ex.: `letra-a/<uuid>/01.npz` |
| `schema_version`, `capture_version` | string | |
| `client_id` | string | UUID gerado no aparelho por gravação; reenvio com o mesmo valor devolve a gravação já salva |
| `reserved_at` | timestamp | Momento da reserva do índice |
| `pose_rate`, `left_hand_rate`, `right_hand_rate`, `any_hand_rate`, `both_hands_rate`, `motion_score` | number | |
| `active_hand` | `left` \| `right` \| `unknown` | Auxiliar (ver npz.md) |
| `legacy_handedness` | string, opcional | Mão dominante declarada no app antigo |
| `validation_flags` | array de string | Códigos, nunca mensagens |
| `reference_similarity_score` | number \| null | |
| `status` | ver abaixo | |
| `user_trust_level` | string | Cópia do nível de quem gravou |
| `counts_as_reference` | bool | `status == accepted` e `user_trust_level == expert`, como no código atual |
| `reviewed_by` | string \| null | uid de quem revisou |
| `reviewed_at`, `created_at`, `updated_at` | timestamp | |
| `deleted_at` | timestamp, opcional | |

Status:
- `uploading`: interno, entre a reserva do índice e a confirmação do arquivo. Nunca aparece na análise nem para a pessoa.
- `unreviewed`: padrão para `regular`.
- `trusted_unreviewed`: padrão para `trusted` e `expert`.
- `accepted` e `rejected`: depois da revisão.
- `deleted`: a pessoa apagou. O `.npz` sai do bucket, mas o documento fica, para a exportação incremental saber que deve remover a linha do índice público.

Revisão: `trusted`, `expert` e `admin` revisam, nunca as próprias gravações.

## `config/*`
- `config/sign_catalog`: `schema_version`, `sign_metadata_schema`. A API gera `signs.json` no bucket a partir dele e de `signs`.
- `config/reference_profiles`: perfis por `sign_id` (UUID), `min_references`, `schema_version`, `build`.
- `config/username_blocklist`: `terms` (array).
- `config/export`: `last_updated_at` da última exportação do índice público.

## Fluxo do upload
1. Transação de reserva: procura o `client_id`; se já existe e foi concluído, devolve a gravação (reenvio). Senão, escolhe o primeiro índice livre até o limite por sinal, conferindo também se o documento daquele índice não existe ou está `deleted`, e cria a gravação como `uploading`.
2. Grava o `.npz` no bucket. Se falhar, a reserva é desfeita.
3. Transação de confirmação: muda o status para o inicial do nível e soma os contadores.

Se a função cair entre 1 e 3, a gravação fica `uploading`. Um reenvio com o mesmo `client_id` depois de 2 minutos retoma a reserva. Sem reenvio, o índice fica preso até um script de limpeza (ainda não escrito) liberar.

## Consultas e índices
Declarados em `firestore.indexes.json`. Consultas fora desta lista precisam de índice novo.

| Uso | Filtros | Ordem |
|---|---|---|
| Análise | `status` | `created_at` desc |
| Análise por sinal | `status`, `sign_id` | `created_at` desc |
| Análise por nível | `status`, `user_trust_level` | `created_at` desc |
| Análise por flag | `status`, `validation_flags` contém | `created_at` desc |
| Análise por pessoa | `status`, `uuid` | `created_at` desc |
| Minhas gravações | `uuid` | `created_at` desc |
| Reenvio | `client_id ==` | — |
| Exportação incremental | `updated_at >` último valor | `updated_at` |
| Perfis de referência | `counts_as_reference == true` | — |
| Ranking | `show_in_ranking == true` | `recording_count` desc |

A análise sempre filtra por um status, para gravações apagadas nunca aparecerem. Busca por trecho de texto não existe; procurar uma pessoa é feito pelo username exato, convertido em `uuid` pela API. Paginação por cursor (`startAfter`), 50 por página.

## Custo estimado por operação
Leituras e escritas de documento, para comparar com a cota gratuita de 50 mil leituras e 20 mil escritas por dia.

| Operação | Leituras | Escritas |
|---|---|---|
| Cadastro | 2 | 2 |
| Upload | cerca de 7 (perfil, sinal, reserva, confirmação, resposta) | 5 (reserva: gravação e usuário; confirmação: gravação, usuário e sinal) |
| Página da análise | 50 | 0 |
| Revisão em lote de 50 | 50 | 100 (gravações e contadores dos sinais) |
| Exportação incremental | 1 por gravação alterada | 1 |
