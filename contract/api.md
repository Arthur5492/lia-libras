# Contrato: API

FastAPI em `backend/libras_api/`. Documentação interativa em `/api/docs` quando a API está rodando.

## Autenticação
`Authorization: Bearer <ID token do Firebase>`. Rotas com perfil exigem cadastro (`POST /api/me`).

| Nível de acesso | Quem |
|---|---|
| Pública | Qualquer pessoa, com cache no CDN |
| Login | Token válido, mesmo sem cadastro |
| Cadastro | Token e perfil em `users/{uid}` |
| Revisão | `trusted`, `expert` ou papel `admin` |
| Admin | Papel `admin` |

## Rotas

| Método e caminho | Acesso | Uso |
|---|---|---|
| `GET /api/health` | Pública | Situação da API |
| `GET /api/signs` | Pública | Catálogo de sinais ativos |
| `GET /api/stats` | Pública | Totais e ranking (só quem optou) |
| `GET /api/usernames/{nome}/available` | Login | Verifica se o username está livre |
| `POST /api/me` | Login | Cadastro: `username`, `consent_version`, `show_in_ranking` |
| `GET /api/me` | Cadastro | Perfil, incluindo `sign_recordings` |
| `PATCH /api/me` | Cadastro | Só `show_in_ranking` |
| `POST /api/recordings` | Cadastro | Upload (formato abaixo). 201 novo, 200 reenvio |
| `GET /api/me/recordings` | Cadastro | Próprias gravações |
| `DELETE /api/me/recordings/{id}` | Cadastro | Apaga a própria gravação |
| `GET /api/recordings/{id}/replay` | Cadastro | Landmarks para o replay (dono ou revisão) |
| `GET /api/review/recordings` | Revisão | `status` obrigatório e no máximo um filtro entre `sign_id`, `trust_level`, `flag` e `username`; `cursor`, `limit` |
| `PATCH /api/review/recordings` | Revisão | `{"updates": [{"id", "status": "accepted" \| "rejected" \| "pending"}]}`, até 50 |
| `GET /api/admin/users` | Admin | Lista paginada ou `?username=` |
| `PATCH /api/admin/users/{uid}` | Admin | `trust_level`, `role` |
| `GET /api/admin/legacy-users` | Admin | Contas do app antigo |
| `POST /api/admin/legacy-users/{uuid}/link` | Admin | `{"uid"}`: vincula a conta antiga a um perfil sem gravações |
| `GET /api/admin/signs` | Admin | Catálogo com inativos |
| `POST /api/admin/signs` | Admin | `name`, `video_url`, `sign_metadata`, `order` |
| `PATCH /api/admin/signs/{id}` | Admin | Mesmos campos e `active`. O slug não muda |
| `PUT /api/admin/sign-metadata-schema` | Admin | Novo esquema de metadados |
| `GET /api/admin/reference-profiles` | Admin | Perfis atuais |
| `POST /api/admin/reference-profiles/rebuild` | Admin | Reconstrói a partir das referências |

## Upload
Coordenadas como listas, sem objetos `{x, y, z}`, para reduzir o tamanho do envio. Frame sem detecção é `null`.

```json
{
  "client_id": "uuid gerado no aparelho, o mesmo em cada reenvio",
  "sign_id": "uuid do sinal",
  "capture_version": "pwa-0.1.0",
  "meta": {"raw_frame_count": 33, "duration_ms": 2010, "record_duration_ms": 2000, "video_width": 640, "video_height": 480},
  "pose": [[[x, y, z, visibility] × 33] | null] × 30,
  "left_hand": [[[x, y, z] × 21] | null] × 30,
  "right_hand": [[[x, y, z] × 21] | null] × 30,
  "hand_labels": [["Left" | "Right" | null, "Left" | "Right" | null] × 30]
}
```

O servidor reaplica a regra das mãos (contract/npz.md), valida e grava o `.npz` 1.1. A resposta traz a gravação e o replay.

## Erros
Sempre `{"code": "...", ...}`. A interface traduz o código.

| HTTP | Códigos |
|---|---|
| 401 | `missing_token`, `invalid_token` |
| 403 | `not_registered`, `reviewer_only`, `admin_only`, `cannot_review_own` |
| 404 | `recording_not_found`, `recording_file_missing`, `user_not_found`, `sign_not_found`, `legacy_user_not_found` |
| 409 | `already_registered`, `username_taken`, `sign_complete`, `upload_in_progress`, `client_id_conflict`, `slug_taken`, `legacy_already_linked`, `user_has_recordings`, `cannot_remove_own_admin` |
| 422 | `invalid_username`, `blocked_username`, `consent_required`, `unknown_sign`, `invalid_client_id`, `low_quality` (com `validation_flags` e `metrics`), `invalid_*_frames`, `invalid_*_shape`, `invalid_*_values`, `invalid_hand_labels`, `invalid_status`, `too_many_filters`, `invalid_cursor`, `invalid_batch_size`, `invalid_sign`, `invalid_role`, `invalid_trust_level`, `invalid_metadata_schema`, `invalid_sign_metadata` |
| 502 | `storage_error` |

## Testes
```bash
npx --prefix tests/firestore-rules firebase emulators:exec --only auth,firestore --project demo-libras ".venv\Scripts\python.exe -m pytest -q"
```
Sem os emuladores, só os testes de domínio rodam (`.venv\Scripts\python.exe -m pytest -q`).
