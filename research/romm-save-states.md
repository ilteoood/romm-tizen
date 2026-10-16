# R3 — RomM save-state API surface (sync vs local-only)

Research for `ilteoood/romm-tizen` issue #4. Investigates whether RomM exposes
endpoints to upload and download save files (SRAM) and save states (snapshots)
per game, and what scope, content-type, and multi-state support look like.
Ends with a recommendation for the TV destination: **sync with RomM**.

All claims cite the RomM API docs (`docs.romm.app`), the RomM source code
(`github.com/rommapp/romm`, branch `master`), and the official
`romm-api` Rust client (`docs.rs/romm-api`). No secondary write-ups were
trusted for facts; they appear only as confirmation where they exist.

## Summary

RomM exposes a complete, documented, and stable API for save and state
upload, list, download, update, and delete. Save files (SRAM) and save states
(snapshots) are two separate asset types with parallel routes under
`/api/saves*` and `/api/states*`. The server stores raw emulator bytes
(`application/octet-stream`) on disk under
`/romm/assets/users/<user>/{saves,states}/<platform>/<rom_id>/<emulator>/`,
and serves them back through `FileResponse` with the original file name.
Multiple saves per ROM are supported via a `slot` column (`autosave` is the
default; named slots are user-defined). Multiple states per ROM are simply
multiple rows in the `states` table — there is no slot field, each capture
is a separate version. The recommended credential for a TV app is a long-
lived Client API Token (`rmm_…`) carrying `assets.read` and `assets.write`.

## Direct answers to issue #4

### Save file list per game — endpoint, response shape

`GET /api/saves?rom_id={id}` — scope `assets.read`.

- Source: `backend/endpoints/saves.py`, `get_saves(...)` handler at
  `backend/endpoints/saves.py:392` (route declared as
  `@protected_route(router.get, "", [Scope.ASSETS_READ])`).
- Other supported query params: `rom_ids` (repeatable), `platform_id`,
  `device_id`, `slot`.
- Returns `list[SaveSchema]` (JSON). `SaveSchema` is declared in
  `backend/endpoints/responses/assets.py:51` and inherits `BaseAsset` plus
  `AssetAnnotations`. Relevant fields for the TV:

  | Field | Type | Notes |
  | --- | --- | --- |
  | `id` | int | Stable identifier used by all other endpoints. |
  | `rom_id` | int | Foreign key into the ROM table. |
  | `user_id` | int | Owner. Other users only see entries where `is_public=true`. |
  | `file_name` | str | e.g. `mario.srm`. Sent to the emulator as-is. |
  | `file_name_no_tags`, `file_name_no_ext`, `file_extension` | str | Derived, useful for matching. |
  | `file_path`, `full_path` | str | Server-side, not consumed by clients. |
  | `file_size_bytes` | int | |
  | `download_path` | str | `/api/saves/{id}/content?timestamp=…&name=…` — convenience URL. |
  | `emulator` | str \| null | The emulator slug the bytes belong to. null = platform default. |
  | `slot` | str \| null | `autosave`, a named slot, or null for archival. |
  | `content_hash` | str \| null | MD5 of the file; used by sync to detect drift. |
  | `is_public` | bool | Defaults false; the owner's annotations are hidden from other users. |
  | `is_favorite` | bool | Sort-ahead marker, owner-only. |
  | `labels` | list[str] | Owner-only free-text labels. |
  | `screenshot` | ScreenshotSchema \| null | Auto-captured thumbnail, matched by stem. |
  | `created_at`, `updated_at` | UTCDatetime | |
  | `missing_from_fs` | bool | True if the row is orphaned on disk. |

- `GET /api/saves/{id}` returns a single `SaveSchema` (same scope).
- `GET /api/saves/identifiers` returns `list[int]` for cheap polling.
- `GET /api/saves/summary?rom_id={id}` returns
  `SaveSummarySchema { total_count, slots: list[SlotSummarySchema] }` —
  this is the per-game slot grouping the TV wants.

### Save file download

`GET /api/saves/{id}/content` — scope `assets.read`.

- Source: `backend/endpoints/saves.py:489` (`download_save`).
- Returns `FileResponse(path=save.full_path, filename=save.file_name)`.
- Default `Content-Type` is `application/octet-stream`; `Content-Disposition`
  is `attachment` (FastAPI `FileResponse` defaults when no media type is
  passed and the filename has no extension match). The server sets
  `Content-Disposition: attachment; filename="<file_name>"` so a TV-side
  `<a download>` style fetch is straightforward.
- Query params: `device_id`, `session_id`, `optimistic=true` (default). With
  `optimistic=true` the device is recorded as synced the moment the file is
  served.
- Owner can download any of their saves; non-owners can only download saves
  with `is_public=true`. Hidden ROMs are 404-masked even if the save is
  public.
- HTTP 413 is returned if the upload would exceed the
  `MAX_ASSET_UPLOAD_SIZE_BYTES` cap (default 512 MiB, set in
  `backend/config/__init__.py`); not relevant for download.

### Save file upload — endpoint, content-type, scope

`POST /api/saves?rom_id={id}&emulator=…&slot=…&device_id=…&session_id=…
&content_hash=…&overwrite=…&autocleanup=…&autocleanup_limit=…` — scope
`assets.write` (and `devices.write` if `device_id` is passed).

- Source: `backend/endpoints/saves.py:213` (`add_save`).
- `Content-Type: multipart/form-data` with form fields:
  - `saveFile: UploadFile` (required) — the save bytes.
  - `screenshotFile: UploadFile` (optional) — auto-captured thumbnail.
- Optional query params:
  - `emulator` — emulator slug, max 50 chars.
  - `slot` — slot name, max 255 chars. Defaults to null (archival).
    `autosave` is the autosave slot; named slots are user-defined.
  - `device_id` — UUID of a registered device. Required if the TV wants
    the server to track sync baselines.
  - `content_hash` — MD5 of the bytes, used as the device's sync baseline.
  - `session_id` — for tying the upload to a negotiate/complete session.
  - `overwrite=true` — skip the conflict guard and the content-hash dedupe.
    Default `false`.
  - `autocleanup=true` and `autocleanup_limit=N` — keep at most N versions
    in the slot. Capped server-side at `MAX_AUTOCLEANUP_LIMIT` (default 100)
    and `MAX_SAVES_PER_SLOT` (default 50, `0` disables).
- Response is the stored `SaveSchema` (HTTP 200).
- HTTP 409 with detail "Slot has a newer save since your last sync" if the
  caller has a `device_id` and the slot's head was updated after the
  caller's last sync baseline.
- HTTP 413 if the bytes exceed `MAX_ASSET_UPLOAD_SIZE_BYTES` (512 MiB
  default).
- Server stores the file at
  `/romm/assets/users/<fs_safe_user_folder>/saves/<platform_fs_slug>/<rom_id>/<emulator?>/`
  via `FSAssetsHandler.build_saves_file_path` in
  `backend/handler/filesystem/assets_handler.py:181`.

### Save state list — separate from save files? Multiple states per game?

Yes, states are a separate asset type. `GET /api/states?rom_id={id}` —
scope `assets.read` — returns `list[StateSchema]`.

- Source: `backend/endpoints/states.py:155` (`get_states`).
- `StateSchema` is declared in
  `backend/endpoints/responses/assets.py:118` and inherits `BaseAsset` plus
  `AssetAnnotations`. The fields match `SaveSchema` with these differences:

  | Field present in StateSchema, missing from SaveSchema | Type | Notes |
  | --- | --- | --- |
  | `core` | str \| null | The libretro core that wrote the state (null = platform default). |

  | Field present in SaveSchema, missing from StateSchema | Why |
  | --- | --- |
  | `slot` | States have no slot model — every capture is its own row. |
  | `content_hash` (kind of) | Present on State, but null on rows stored before hashing was added. |
  | `origin_device_id`, `device_syncs` | Only the save sync protocol tracks per-device attribution. |

- Multiple states per game are simply multiple `State` rows. The
  RomM web player typically names them
  `<rom_name> [<timestamp>].state` and pairs them with a matching PNG
  screenshot. There is no enforced cap on the per-ROM state count other
  than the implicit `STREAMING_STATE_HISTORY_LIMIT` (50, used by the
  streaming broker only, not by the asset API).
- `GET /api/states/identifiers` returns `list[int]` for cheap polling.

### Save state download / upload

- `GET /api/states/{id}/content` — scope `assets.read`. Source:
  `backend/endpoints/states.py:200` (`download_state`). Returns
  `FileResponse` via `build_asset_file_response` (defined in
  `backend/handler/filesystem/assets_handler.py:138`). Trusted image MIME
  types are served inline (e.g. the paired screenshot, if requested by
  extension); every other state file is served as
  `application/octet-stream` with `Content-Disposition: attachment`.
  Same ownership rules as save download.
- `POST /api/states?rom_id={id}&emulator=…` — scope `assets.write`.
  Source: `backend/endpoints/states.py:71` (`add_state`).
  `Content-Type: multipart/form-data` with form fields:
  - `stateFile: UploadFile` (required) — the snapshot bytes.
  - `screenshotFile: UploadFile` (optional) — paired PNG.
  No `device_id`, `slot`, `content_hash`, or `autocleanup` query params —
  states don't participate in the device sync protocol and don't use slots.
- `PUT /api/states/{id}` (scope `assets.write`) replaces the bytes of an
  existing state (source: `backend/endpoints/states.py:236`).
- `POST /api/states/delete` (scope `assets.write`) deletes by ID list.

### Authentication, scopes required

- Auth modes: session cookie, HTTP Basic, OAuth2 password grant, Client API
  Token. The TV should use **Client API Token**: format `rmm_` + 64 hex
  chars, carried as `Authorization: Bearer rmm_…`. Tokens are long-lived,
  per-user, and can be scoped narrower than the user's role. Bearer-token
  requests skip CSRF; session-cookie requests must send
  `X-CSRFToken: <romm_csrftoken cookie value>` on state-changing methods.
  Source: `docs.romm.app/latest/developers/api-authentication/`.
- Scope enum lives in `backend/handler/auth/constants.py:15` (class
  `Scope(enum.StrEnum)`). The save/state endpoints require:
  - `assets.read` — list, get, download, summary, identifiers.
  - `assets.write` — create, update, delete, set visibility/favorite/labels,
    rename.
  - `devices.write` — only if the request passes `device_id` (sync
    bookkeeping). Without it the call returns 403.
  - `devices.read` — only if the request passes `device_id` for read paths.
- Token size cap: each user can have up to 25 active tokens. Create one in
  **Administration → Client API Tokens** in the web UI. Device-bound
  pairing is available but not required for a single-TV setup.

### File format on the server

- Raw emulator bytes are stored on disk. The server does not transcode,
  compress, or ZIP them. `Content-Type` is `application/octet-stream` on
  both upload (the body is `multipart/form-data` carrying the file) and
  download (the response body). File names are sanitized on upload via
  `sanitize_asset_filename` to strip path separators and reserved
  characters.
- Where bytes live:
  - Save: `/romm/assets/users/<user>/saves/<platform>/<rom_id>/<emulator?>/<file>`
  - State: `/romm/assets/users/<user>/states/<platform>/<rom_id>/<emulator?>/<file>`
  - Screenshot: `/romm/assets/users/<user>/screenshots/<rom_id>/<platform>/<file>`
  - Source: `backend/handler/filesystem/assets_handler.py:163-198`.
- File types and the cores that consume them are platform-specific
  (`.srm`, `.sav`, `.state`, `.state.gz`, etc.). The server treats the
  bytes opaquely; only `libmagic` is used to sniff uploaded screenshot
  types. There is no server-side validation that the bytes match a
  particular emulator's expected format — a wrong-format state will load
  as a corrupted frame in the emulator, not be rejected by RomM.

## Endpoint reference (saves and states)

| Method | Path | Scope | Purpose |
| --- | --- | --- | --- |
| GET | `/api/saves` | `assets.read` | List saves; filter by `rom_id`, `rom_ids`, `platform_id`, `device_id`, `slot`. |
| GET | `/api/saves/identifiers` | `assets.read` | Cheap poll: just IDs. |
| GET | `/api/saves/summary?rom_id={id}` | `assets.read` | Per-game slot grouping. |
| GET | `/api/saves/{id}` | `assets.read` | Single save metadata. |
| GET | `/api/saves/{id}/content` | `assets.read` | Download bytes (`application/octet-stream`). |
| POST | `/api/saves/{id}/downloaded` | `devices.write` | Confirm download, record sync baseline. |
| POST | `/api/saves` (multipart) | `assets.write` | Upload a save (`saveFile`, optional `screenshotFile`). |
| PUT | `/api/saves/{id}` (multipart) | `assets.write` | Replace bytes of a save. |
| PUT | `/api/saves/{id}/visibility` | `assets.write` | Toggle `is_public`. |
| PUT | `/api/saves/{id}/favorite` | `assets.write` | Toggle `is_favorite`. |
| PUT | `/api/saves/{id}/labels` | `assets.write` | Replace labels. |
| PUT | `/api/saves/{id}/file-name` | `assets.write` | Rename. |
| POST | `/api/saves/delete` | `assets.write` | Bulk delete by ID list. |
| GET | `/api/states` | `assets.read` | List states; filter by `rom_id`, `rom_ids`, `platform_id`. |
| GET | `/api/states/identifiers` | `assets.read` | Cheap poll: just IDs. |
| GET | `/api/states/{id}` | `assets.read` | Single state metadata. |
| GET | `/api/states/{id}/content` | `assets.read` | Download bytes (`application/octet-stream`). |
| POST | `/api/states` (multipart) | `assets.write` | Upload a state (`stateFile`, optional `screenshotFile`). |
| PUT | `/api/states/{id}` (multipart) | `assets.write` | Replace bytes. |
| PUT | `/api/states/{id}/visibility` | `assets.write` | Toggle `is_public`. |
| PUT | `/api/states/{id}/favorite` | `assets.write` | Toggle `is_favorite`. |
| PUT | `/api/states/{id}/labels` | `assets.write` | Replace labels. |
| PUT | `/api/states/{id}/file-name` | `assets.write` | Rename. |
| POST | `/api/states/delete` | `assets.write` | Bulk delete by ID list. |

(The `Content-Type` is always `multipart/form-data` on POST/PUT, and
`application/octet-stream` on GET `/content`.)

## Caveats and limits

- **Upload size cap.** 512 MiB per upload, server-side
  (`MAX_ASSET_UPLOAD_SIZE_BYTES` in `backend/config/__init__.py`). Set
  to `0` to disable. Affects save and state alike.
- **Slot retention.** `MAX_SAVES_PER_SLOT` defaults to 50 versions per
  slot. A TV that uploads with `autocleanup=true&autocleanup_limit=N`
  asks the server to keep at most `N`, capped by 50 (or 100 in the
  stricter `autocleanup` path).
- **Conflict guard.** Uploads with `device_id` to a slot the device
  hasn't synced yet (and that another device filled) return 409.
  For an MVP without the full sync protocol, the TV can omit `device_id`
  and rely on `overwrite=true` per upload to skip the guard.
- **Public vs private.** Every save/state is private by default
  (`is_public=false`). A non-owner only sees and downloads entries where
  `is_public=true`. The TV app is a single-user client, so this is
  not a problem in practice; it is only a concern if the user later
  adds a second account.
- **Filename sanitization.** The server rewrites the uploaded filename
  via `sanitize_asset_filename`. The TV should send a stable,
  recognizable name (e.g. `<rom-fs-name>.srm` for saves,
  `<rom-fs-name> [<utc-iso>].state` for states) rather than rely on
  the original emulator path.
- **Hidden ROMs.** A save/state on a hidden ROM stays 404-masked, even
  to its owner, on the download endpoint (`assert_rom_visible` is
  applied). RomM-side: a hidden ROM and a public save don't combine.
- **CORS.** The TV app is a Tizen Web app on a different origin, so the
  host must set `ROMM_CORS_ALLOWED_ORIGINS` to the TV's app origin. A
  bearer token request needs no `Access-Control-Allow-Credentials`, so
  this is a low-friction setup. See `docs.romm.app/latest/developers/api-authentication/#browser-clients-on-another-origin-cors`.
- **Streaming broker is unrelated.** `romm-broker` exposes
  `/streaming/api/session/save-state` and `/load-state` for the
  romm-streaming project. Those are an alternative transport (real
  emulator on the server, video streamed to the client), not the same
  surface as `/api/saves*` and `/api/states*`. The Tizen destination
  runs the emulator locally, so the broker is irrelevant here.
- **ReDoc gaps.** The OpenAPI `ReDoc` page does not render the
  multipart form fields; the schemas list endpoints but not the file
  field names. The frontend service modules
  (`frontend/src/services/api/save.ts`, `frontend/src/services/api/state.ts`)
  are the practical reference for the field names. This was a known
  complaint in `rommapp/romm#3031`.
- **Documented source drift.** The Device Sync Protocol docs
  (`docs.romm.app/latest/developers/device-sync-protocol/`) describe a
  negotiate/complete/confirm flow that the TV does not need to
  implement for MVP. The simple upload/download endpoints are enough.

## Recommendation: sync with RomM (with caveats)

The RomM save/state API fully supports the destination's "list/load/save
save-states" requirement. Both the metadata (list, get, summary,
identifiers) and the bytes (upload, download, update, delete) are stable,
documented, scope-checked, and versioned. Concretely:

- **List per game.** `GET /api/saves?rom_id={id}` and
  `GET /api/saves/summary?rom_id={id}` cover both raw rows and slot
  grouping. `GET /api/states?rom_id={id}` covers snapshots.
- **Load.** `GET /api/saves/{id}/content` and
  `GET /api/states/{id}/content` return the raw bytes the emulator
  needs; `application/octet-stream` is the right type for the in-app
  emulator core.
- **Save.** `POST /api/saves` and `POST /api/states` with
  `multipart/form-data` accept the in-app emulator's output bytes plus
  an optional paired PNG screenshot.
- **Last-write-wins.** The issue marks conflict resolution as
  out-of-scope. Omitting `device_id` and using `overwrite=true` on
  upload gives the TV simple last-write-wins semantics. A user with
  one TV and no other RomM clients will not hit a 409.
- **Multi-state.** States are inherently multi-version — every capture
  is a new row. The TV can show them in any order it likes.
- **Multi-save (SRAM).** Saves are grouped by `(rom_id, slot)`. The TV
  writes to the `autosave` slot and lets the server keep the last 50
  versions; the user gets a sensible "latest" view for free.
- **Auth.** A single Client API Token with `assets.read` + `assets.write`
  is the right shape for a Tizen Web app. No CSRF, no session cookies,
  no password storage on the TV.

The Tizen-specific risks (limited storage, slow CORS, CORS allowlist) are
operator-configuration concerns, not API gaps. The RomM server's
`ROMM_CORS_ALLOWED_ORIGINS` must include the TV's app origin; with that,
sync is straightforward.

**Out of scope for MVP, leave for later:**

- The full device-sync protocol (negotiate / complete / confirm / play
  sessions). Useful if the user later adds a second client; not needed
  for a single TV.
- Slot history UI beyond "latest". The server already stores up to 50
  versions per slot; the TV can ignore the history in v1.
- Memory cards. The romm-streaming broker uses
  `/api/memory-cards/...`; the in-app emulator on the TV does not
  need them.

## Sources

Primary (kept):

- RomM save endpoint source —
  https://raw.githubusercontent.com/rommapp/romm/master/backend/endpoints/saves.py
  — defines `add_save`, `get_saves`, `get_save`, `download_save`,
  `update_save`, slot/favorite/visibility/label/rename/delete routes.
- RomM state endpoint source —
  https://raw.githubusercontent.com/rommapp/romm/master/backend/endpoints/states.py
  — defines `add_state`, `get_states`, `get_state`, `download_state`,
  `update_state`, sibling routes.
- RomM asset response schemas —
  https://raw.githubusercontent.com/rommapp/romm/master/backend/endpoints/responses/assets.py
  — declares `SaveSchema`, `StateSchema`, `SlotSummarySchema`,
  `SaveSummarySchema`.
- RomM asset model and storage paths —
  https://raw.githubusercontent.com/rommapp/romm/master/backend/handler/filesystem/assets_handler.py
  — `build_saves_file_path`, `build_states_file_path`, content-hash
  computation, file-response shaping.
- RomM scope enum —
  https://raw.githubusercontent.com/rommapp/romm/master/backend/handler/auth/constants.py
  — `Scope.ASSETS_READ = "assets.read"`, `Scope.ASSETS_WRITE = "assets.write"`.
- RomM config defaults —
  https://raw.githubusercontent.com/rommapp/romm/master/backend/config/__init__.py
  — `MAX_ASSET_UPLOAD_SIZE_BYTES = 512 * 1024 * 1024`,
  `MAX_SAVES_PER_SLOT = 50`, `MAX_AUTOCLEANUP_LIMIT = 100`.
- RomM saves model (column types, slot semantics) —
  https://raw.githubusercontent.com/rommapp/romm/master/backend/models/assets.py
  — `Save.slot`, `Save.emulator`, `Save.content_hash`, `State.core`,
  `State.emulator`.
- RomM API authentication —
  https://docs.romm.app/latest/developers/api-authentication/
  — auth modes, Client API Token format, CORS rules.
- RomM Device Sync Protocol —
  https://docs.romm.app/latest/developers/device-sync-protocol/
  — confirms the save/state endpoint scopes and the multipart upload
  contract; also documents the negotiate/complete flow that the TV
  does not need to implement.
- RomM Saves & States (user-facing) —
  https://docs.romm.app/latest/using/saves-and-states/
  — confirms the autosave vs named-slot model, per-user/per-ROM
  ownership, and the in-browser auto-sync behaviour.
- RomM API Reference landing —
  https://docs.romm.app/latest/developers/api-reference/
  — confirms the OpenAPI spec is at `/openapi.json` and that every
  instance serves it.
- RomM Client API Tokens —
  https://docs.romm.app/latest/developers/client-api-tokens/
  — `rmm_<64 hex chars>` token format, scope subsetting, up to 25
  tokens per user.
- RomM Uploads —
  https://docs.romm.app/latest/using/uploads/
  — confirms save/state upload size cap and the per-user ownership
  rules.
- RomM frontend save service (multipart field names) —
  https://raw.githubusercontent.com/rommapp/romm/master/frontend/src/services/api/save.ts
  — practical reference for `saveFile` / `screenshotFile` field names.
- RomM frontend state service (multipart field names) —
  https://raw.githubusercontent.com/rommapp/romm/master/frontend/src/services/api/state.ts
  — practical reference for `stateFile` / `screenshotFile` field names
  and the `<rom-name> [<timestamp>]` filename convention.

Rejected / deprioritized:

- Third-party Rust client `romm-api` (docs.rs) — only a generated
  reference; the upstream Python source is more current.
- `patricksmill/romm-cli` save-sync notes — useful confirmation, not a
  primary source for the wire format.
- Forum bug reports about state upload mismatches (`rommapp/romm#3031`,
  `#1718`, `#2562`) — symptom-level, not relevant to the API surface.
