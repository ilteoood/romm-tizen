# RomM REST API — library surface research

Issue: [#3 — R2 — RomM REST API: library + ROM download](https://github.com/ilteoood/romm-tizen/issues/3)
Target client: `src/api/romm.ts` in `ilteoood/romm-tizen`.
RomM version checked: **5.4.0** (OpenAPI title "RomM API", 5.4.0, served from
`https://demo.romm.app/openapi.json`).
Source: `rommapp/romm` master branch on 2026-10-16 (the OpenAPI spec ships with
every release; routes and schemas below come from it and from the matching
backend source files in `rommapp/romm`).

Every endpoint claim below is backed by the cited source. Claims marked
*interpretation* are researcher inference, not text from the source.

---

## 1. Auth

### 1.1 Client API Token (recommended for a TV client)

- **Header**: `Authorization: Bearer rmm_<64-hex-chars>`.
- **Token format**: `rmm_` + 64 hex characters, e.g. `rmm_abcdef0123456789…`.
- **Issuance**: per-user from Administration → Client API Tokens, up to 25
  active tokens per user. Each carries a subset of the issuing user's scopes.
- **Expiry**: optional; if not set, token does not expire.
- **Source**:
  - [API Authentication — Client API tokens](https://docs.romm.app/latest/developers/api-authentication/#client-api-tokens-for-companion-apps)
  - `backend/handler/auth/constants.py` line 12: `CLIENT_TOKEN_PREFIX: Final = "rmm_"`
  - `backend/handler/auth/hybrid_auth.py` resolves the bearer through the
    ClientToken table (referenced in the auth doc).

Other auth modes all hit the same backend and resolve to the same scope model,
but the docs and the Grout/Argosy companion-app guidance both call out Client
API Tokens as the path for a long-lived, non-interactive client. A TV
companion app on a TV without a browser is exactly that case.

- [Session cookie]: `Cookie: romm_session=…` after `POST /api/login`. Needs
  CSRF (`X-CSRFToken: <romm_csrftoken>`) for state-changing calls.
- [HTTP Basic]: `Authorization: Basic base64(user:password)`. Convenient for
  scripts, no CSRF.
- [OAuth2 Bearer JWT]: `Authorization: Bearer <jwt>`. Short-lived (15 min
  default), needs refresh dance. More state to manage than a Client API Token.
- [OIDC]: redirect-flow only; not usable directly from a TV app.

All four other modes resolve to the same per-endpoint scope check.

### 1.2 Required scopes per endpoint

The full per-endpoint scope list is in the OpenAPI spec at
`https://demo.romm.app/openapi.json` (under `security`). The library surface
only needs these read scopes:

| Endpoint | Method | Scope |
| --- | --- | --- |
| `/api/platforms` (and `/api/platforms/{id}`, `/identifiers`, `/supported`, `/filesystem`) | GET | `platforms.read` |
| `/api/roms` (and `/api/roms/{id}`, `/api/roms/{id}/simple`, `/api/roms/{id}/content/*`, `/api/roms/by-metadata-provider`, `/api/roms/by-hash`, `/api/roms/filters`, `/api/roms/random`, `/api/roms/download`, `/api/roms/identifiers`) | GET | `roms.read` |
| `/api/collections` (and `/api/collections/{id}`, `/identifiers`, `/smart`, `/smart/{id}`, `/smart/identifiers`, `/virtual`, `/virtual/{id}`, `/virtual/identifiers`) | GET | `collections.read` |

Source for the catalogue:
- `backend/handler/auth/constants.py` defines the scope enum
  (`Scope.PLATFORMS_READ = "platforms.read"`, etc.).
- The OpenAPI spec lists `security: [{"OAuth2PasswordBearer": ["roms.read"]},
  {"HTTPBasic": []}]` on every relevant route.

The list / detail / cover / download endpoints the TV client needs are all
`*.read`. No write scope is required for read-only browsing and downloading.

### 1.3 Error model

From the auth doc:
- `401 Unauthorized` — no credential, expired credential, bad credential.
- `403 Forbidden` — authenticated but missing a required scope.
- `404 Not Found` — resource doesn't exist, or, for privacy, the identity
  can't see it (RomM does not 403 on hidden resources; it 404s, so the client
  cannot enumerate them).

### 1.4 CORS

`ROMM_CORS_ALLOWED_ORIGINS` is empty by default; an empty list denies every
cross-origin request (changed in 5.4.0 — see the 5.4.0 release notes:
"Cross-origin requests are denied by default. An unset or empty
`ROMM_CORS_ALLOWED_ORIGINS` used to allow every origin, and now allows
none.").

A Tizen app is a native HTTP client, not a browser, so CORS does not apply.
This is a non-issue for the TV client.

Source: [API Authentication — Browser clients on another origin (CORS)](https://docs.romm.app/latest/developers/api-authentication/#browser-clients-on-another-origin-cors)
and the [5.4.0 release notes](https://github.com/rommapp/romm/releases).

---

## 2. Platforms list

### 2.1 Endpoint

- **Path**: `GET /api/platforms`
- **Scope**: `platforms.read`
- **Query params**:
  - `updated_after` (ISO 8601 datetime, optional) — only return platforms
    updated after this timestamp.
- **Response**: `array<PlatformSchema>` (JSON).
- **Source**: `backend/endpoints/platform.py` lines 53-69
  (`@protected_route(router.get, "", [Scope.PLATFORMS_READ])`).
- **OpenAPI**: see `/api/platforms` in `https://demo.romm.app/openapi.json`.

A `GET /api/platforms/identifiers` variant returns just `int[]` ids (same
scope, cheaper payload, for sync-style clients). Other variants:
`/supported` (the static catalogue, not the user's library),
`/filesystem` (folders on disk not yet in the database). None of these are
needed for the TV browse flow.

### 2.2 `PlatformSchema` shape

From `backend/endpoints/responses/platform.py`:

```
id                int
slug              str           # e.g. "n64", "snes"
fs_slug           str           # filesystem folder name; usually == slug
rom_count         int
name              str           # canonical display name (e.g. "Nintendo 64")
custom_name       str | None    # user override; `display_name` is custom_name or name
description       str | None
igdb_slug, moby_slug, hltb_slug, libretro_slug   str | None
igdb_id, sgdb_id, moby_id, launchbox_id, ss_id,
ra_id, hasheous_id, tgdb_id, flashpoint_id       int | str | None
category, generation, family_name, family_slug   str | int | None
url, url_logo                                   str | None
firmware          list<FirmwareSchema>
firmware_count    int (computed) # count of `firmware` list
display_name      str (computed) # custom_name or name
abbreviation      str (computed) # platform_abbreviation(slug)
alternative_names list[str]     # computed
created_at, updated_at          datetime
fs_size_bytes     int
is_unidentified   bool
is_identified     bool
missing_from_fs   bool
```

The TV client cares about: `id`, `slug`, `fs_slug`, `rom_count`, `name`,
`custom_name` (or the computed `display_name`).

---

## 3. Games / ROMs list

### 3.1 Endpoint

- **Path**: `GET /api/roms`
- **Scope**: `roms.read`
- **Source**: `backend/endpoints/roms/__init__.py` lines 351-545
  (`@protected_route(router.get, "", [Scope.ROMS_READ])`).

The handler returns a `CustomLimitOffsetPage[SimpleRomSchema]`, defined in the
same file (lines 268-275): an extended page envelope with `total`, the
char-index, the rom-id-index, and the per-filter dropdown values.

### 3.2 Response envelope

```
CustomLimitOffsetPage[SimpleRomSchema]:
  items: list<SimpleRomSchema>
  total: int | None         # null when caller passes with_total=false
  limit: int
  offset: int
  char_index: dict[str, int]  # letter → offset, for A-Z jump bars
  rom_id_index: list[int]     # full ordered id list, for virtual scroll
  filter_values: RomFiltersDict  # available values per filter dropdown
```

`char_index`, `rom_id_index`, and `filter_values` only matter for the full
web client. The TV client can request all of them on the first page and ignore
them on later pages (set `with_char_index=false`, `with_filter_values=false`,
`with_rom_id_index=false`, `with_total=false`).

### 3.3 Query parameters

#### Page / response flags (from the FastAPI `Query(...)` annotations on
`get_roms`, lines 367-411)

| Param | Default | Effect |
| --- | --- | --- |
| `limit` | (from `PAGE_QUERY`) | Page size. |
| `offset` | 0 | Page offset. |
| `with_char_index` | `true` | Compute the A-Z offset map. |
| `with_filter_values` | `true` | Compute the per-filter dropdown values. |
| `with_rom_id_index` | `true` | Compute the full ordered id list (the virtual scroll backbone). |
| `with_total` | `true` | Compute the total row count. Set `false` on subsequent pages to skip the count scan (PR #4062). |
| `with_files` | `false` | Include each rom's `RomFileSchema[]` (heavy). Off by default — turn on for download or detail screens. |
| `order_by` | `""` | Empty triggers a relevance-ordered search when the term is "two or more words, or at least three characters"; otherwise a column name. |
| `order_dir` | `"asc"` | `asc` or `desc`. |
| `updated_after` | — | ISO 8601 datetime filter. |
| `released_days` | — | Repeatable, e.g. `9-8`. Calendar-day match. Up to 12. |
| `released_before_year` | — | Exclusive upper bound on release year. |

#### Filters (from `RomFilterParams` in
`backend/handler/database/rom_filters.py`)

| Param | Type | Notes |
| --- | --- | --- |
| `search_term` | str | Server-side search. |
| `platform_ids` | int[] (repeat) | Scope filter. |
| `collection_id` | int | Scope filter. |
| `virtual_collection_id` | str | Scope filter (e.g. "recent", "random"). |
| `smart_collection_id` | int | Scope filter. |
| `matched`, `favorite`, `duplicate`, `last_played`, `playable`, `missing`, `physical`, `has_ra`, `has_saves`, `has_states`, `verified`, `has_soundtrack` | bool? | Per-rom booleans. |
| `group_by_meta_id` | bool | Collapse duplicate regional releases into one entry (default `false`). |
| `genres`, `franchises`, `collections`, `companies`, `publishers`, `developers`, `age_ratings`, `statuses`, `regions`, `languages`, `player_counts`, `metadata_providers`, `tags` | string[] (repeat) | Each has a sibling `<name>_logic` of `any` / `all` / `none` (default `any`). |
| `hltb_main_story_min`, `hltb_main_story_max` | int (seconds) | HowLongToBeat range; excludes roms without an HLTB time. |

`updated_after`, `released_days`, and `released_before_year` are mutually
exclusive with the search/filter model only in the sense that the cache key
treats them as additional narrowing. They can be combined freely.

### 3.4 `SimpleRomSchema` shape (the list payload)

`SimpleRomSchema(RomSchema)` from `backend/endpoints/responses/rom.py`
(line 504+). Fields the TV client renders on a card:

```
id, name, name_sort_key, slug, summary
platform_id, platform_slug, platform_fs_slug,
  platform_custom_name, platform_display_name
fs_name, fs_name_no_tags, fs_name_no_ext, fs_extension
fs_size_bytes
metadatum.genres, .franchises, .collections, .companies,
            .publishers, .developers, .game_modes, .age_ratings,
            .player_count, .first_release_date, .average_rating
regions, languages, tags
is_identified, is_unidentified
has_notes
rom_user: RomUserSchema   # backlogged, now_playing, hidden, rating, status
path_cover_small, path_cover_large, url_cover
screenshot_path | None     # "continue playing" rail thumb
files: list<RomFileSchema> # only present when with_files=true
sibling_roms: list<SiblingRomSchema>
```

`SimpleRomSchema` is a strict superset of `RomSchema`; `DetailedRomSchema`
adds `user_saves`, `user_states`, `user_screenshots`, `all_user_*`,
`user_collections`, `all_user_notes`, `download_formats`. Use
`GET /api/roms/{id}/simple` for an interactive detail page (light, no
eager-loaded user arrays) and `GET /api/roms/{id}` only when the detail
screen needs the full `download_formats`, the user's notes, or shared
community saves.

### 3.5 Pagination — virtual scroll mechanics

The pattern the frontend (and any virtual-scroll client) uses:

1. **First call** with `with_rom_id_index=true`:
   - `items` is the first page (defaults to `limit=offset+limit`).
   - `rom_id_index` is the full ordered id list of the entire filter result.
   - `total` matches `len(rom_id_index)`.
2. **Window calls** for scrolling with `with_rom_id_index=false`,
   `with_total=false`:
   - `GET /api/roms?platform_ids=N&order_by=name&order_dir=asc&offset=0&limit=50`
   - Skips the index computation and the count.
3. **Char jump**: the `char_index` maps each letter to an offset; jump
   straight to `offset=<char_index['M']>`.

The cache is per-filter-scope: only the **fully unscoped** library scan is
cached (lines 437-450 of the roms handler). Any filter narrows the query
and gates the sidecar cache.

For the TV client: the simple list response is enough; if you don't need
virtual scroll, send `with_rom_id_index=false` and the first call already
returns only the requested page.

---

## 4. Collections

### 4.1 Endpoints

Source: `backend/endpoints/collections.py`.

| Path | Method | Scope | Returns |
| --- | --- | --- | --- |
| `/api/collections` | GET | `collections.read` | `array<CollectionSchema>` — user's collections + public ones. |
| `/api/collections/{id}` | GET | `collections.read` | Single `CollectionSchema`. |
| `/api/collections/identifiers` | GET | `collections.read` | `int[]` (own + public). |
| `/api/collections/smart` | GET | `collections.read` | `array<SmartCollectionSchema>` — user-defined filtered collections. |
| `/api/collections/smart/{id}` | GET | `collections.read` | Single smart collection. |
| `/api/collections/smart/identifiers` | GET | `collections.read` | `int[]`. |
| `/api/collections/virtual` | GET | `collections.read` | `array<VirtualCollectionSchema>` — server-derived, e.g. `?type=recent`, `?type=random`. |
| `/api/collections/virtual/{id}` | GET | `collections.read` | One virtual collection. |
| `/api/collections/virtual/identifiers` | GET | `collections.read` | `string[]`. |

### 4.2 Collection shapes

From `backend/endpoints/responses/collection.py`:

```
BaseCollectionSchema:
  name, description
  rom_ids: set[int]           # empty after server-side hidden-rom filter
  path_cover_small, path_cover_large: str | None
  path_covers_small, path_covers_large: list[str]  # gallery cover strip
  is_public, is_favorite, is_virtual, is_smart: bool
  created_at, updated_at
  rom_count: int (computed, len(rom_ids))

CollectionSchema: + id, url_cover, user_id, owner_username
SmartCollectionSchema: + id, filter_criteria (object), filter_summary (str),
                          user_id, owner_username
VirtualCollectionSchema: + id (str), type (str), is_virtual = True
```

### 4.3 Filtering ROMs by collection

There is **no separate `?collection_id` filter on `/api/roms`**; instead, the
collection's `rom_ids` set is the list. Two reasonable flows:

- Light UI: call `GET /api/collections/{id}` to get the id + cover + name;
  then call `GET /api/roms?platform_ids=…&search_term=…&limit=10000` and
  intersect in the client. *Cheaper for sparse pagination but loses server
  sort/filter benefits.*
- Full UI: call `GET /api/roms?collection_id={id}&order_by=name&order_dir=asc`
  and let the server do the work. The server applies the same `RomFilterParams`
  model (see `rom_filters.py`, `_SCOPE_FIELDS`).

`virtual_collection_id` and `smart_collection_id` are the same pattern.

---

## 5. ROM download

### 5.1 Single-rom endpoint (recommended)

- **Path**: `GET /api/roms/{id}/content/{file_name}`
- **Method**: GET (download) and HEAD (size check)
- **Scope**: `roms.read` (overridable by the server config flag
  `DISABLE_DOWNLOAD_ENDPOINT_AUTH` — see source comment "[] if
  DISABLE_DOWNLOAD_ENDPOINT_AUTH else [Scope.ROMS_READ]" on lines 555-556
  and 707-708 of `backend/endpoints/roms/__init__.py`).
- **`{id}`**: internal Rom.id (NOT a file id).
- **`{file_name}`**: a path-param used as the base name for the multi-file
  zip; for a single-file rom it can be anything (the response header carries
  the real filename).

Source: `backend/endpoints/roms/__init__.py` lines 692-806
(`get_rom_content`).

### 5.2 What the server returns

- **Single file rom**: HTTP 302-style internal redirect via
  `X-Accel-Redirect: /library/{fs_path}` (in production behind nginx), or a
  `FileResponse` in `DEV_MODE`. Headers set by `FileRedirectResponse`
  (`backend/utils/nginx.py`):
  - `Content-Type: application/octet-stream`
  - `Content-Disposition: attachment; filename="<real>"; filename*=UTF-8''<urlencoded>`
  - `Content-Length: <fs_size_bytes>`
- **Multi-file rom**:
  - If the client sends `Range`: served from a cached zip on
    `X-Accel-Redirect: /cache/<namespace>.zip` (resumable).
  - Otherwise: streamed as an `X-Archive-Files: zip` manifest for nginx's
    `mod_zip` to assemble, or built in memory and sent as
    `application/zip` in `DEV_MODE`.

### 5.3 Range requests

Yes — Range requests are supported and explicit (the source comment on
`get_rom_content`: "Multi-file path: serve cached ZIP for Range requests
(resumable), fall through to mod_zip streaming for non-Range requests.").

The single-file path lets nginx do the range parsing via `X-Accel-Redirect`;
in `DEV_MODE`, Starlette's `FileResponse` honors `Range` natively. The
multi-file path requires a one-time cached zip on disk (under
`${ROMM_CACHE_BASE_PATH}/`) for Range; otherwise the first request builds it.

### 5.4 Head request (size probe)

`HEAD /api/roms/{id}/content/{file_name}` returns the headers a GET would set
(Content-Type, Content-Length, Content-Disposition, Accept-Ranges) without
the body. Useful for "is this file complete?" and for showing size in the UI
without a GET.

### 5.5 Format negotiation (?format=…)

`?format=zso,iso` is a server-side format-conversion feature (see
`backend/endpoints/roms/__init__.py` `get_rom_content` + `utils/conversion_cache.py`):

- If the stored file already matches a requested format: serve the file.
- If a conversion is needed and can run: 202 Accepted + `Retry-After: <seconds>`.
- If no requested format can be produced: 406 Not Acceptable.
- Single-file only — returns 406 for multi-file roms.

Not needed for the TV client's library surface, but a player can opt in.

### 5.6 `?purpose=play` (audit tagging)

`GET /api/roms/{id}/content/{file_name}?purpose=play` records the load as
`ROM_PLAYER_LOAD` rather than `ROM_DOWNLOAD` in the audit log. The server
does not change the bytes it sends. Cosmetic, but useful if the operator
audits which app initiated the download.

### 5.7 Bulk download (optional, out of scope for first cut)

- `GET /api/roms/download?rom_ids=1,2,3` or
  `?platform_id=N&filename=...` returns a zip of multiple roms.
- `roms.read` scope, rate-limited only by the same nginx path (no explicit
  rate-limit middleware; the docs do not document a per-user rate limit).

### 5.8 Per-file download (alternative)

- `GET /api/roms/{id}/files/content/{file_name}` where `{id}` is the
  `RomFile.id` (not the Rom.id). Returns the file with the right
  Content-Type (audio inline, video inline, document inline with nosniff +
  CSP-sandbox for HTML, octet-stream attachment otherwise). Use this only
  if you need the original per-file media type for an in-app viewer.
- `roms.read` scope. Range requests: same nginx story (in production,
  X-Accel-Redirect; in dev, Starlette).

Source: `backend/endpoints/roms/files.py` `get_romfile_content`.

### 5.9 Rate limits

The RomM 5.4.0 source has no FastAPI-side rate-limit middleware on download
endpoints. The bundled nginx template (`docker/nginx/templates/default.conf.template`)
has no `limit_req` directive either. Throughput is bounded by `client_max_body_size 0`
in reverse-proxy examples and by the host's disk + network. If a deployment
needs a rate limit, the reverse proxy must impose it.

This is a gap to flag in the design doc — a Tizen client is unlikely to be
abusive, but a buggy retry loop is easy to write.

---

## 6. Search

### 6.1 Library search

- **Query param**: `search_term` on `GET /api/roms`. Server-side only; no
  client-side fuzzy mode is exposed.
- **Sort with `order_by=""` (empty)** is the relevance order — the OpenAPI
  description on the roms endpoint: "Leave empty to order a search of two
  or more words, or at least three characters, by relevance: exact name
  or alias matches first, then names starting with the term, then phrase
  matches."
- **No** full-text/FTS toggle; the server picks the search mode based on the
  term length and the `order_by` value.
- Implementation: `db_rom_handler.get_roms_query` and `filter_roms` build a
  SQLAlchemy query; the relevance order is a CASE on name/alias. Source:
  `backend/endpoints/roms/__init__.py` and the `with_char_index` branch that
  skips when `db_rom_handler.search_relevance_leads(order_by, filters.search_term)`
  is true.

### 6.2 Metadata-provider search (not library search)

- `GET /api/search/roms?rom_id={id}&search_term=…&search_by=name|id` —
  queries external metadata providers (IGDB, Moby, ScreenScraper, LaunchBox,
  Flashpoint, Demozoo, Steam) to **rematch** an existing library rom to a
  different metadata record. Returns a list of candidate matches the user
  can pick. Source: `backend/endpoints/search.py` `search_rom`.
- `GET /api/search/cover?search_term=…` — searches cover-art providers
  (SteamGridDB, Steam) for new cover art. Source: `backend/endpoints/search.py`
  `search_cover`.

Both need the user to be reading what the metadata provider finds; the TV
client probably doesn't need either on the read-only path.

### 6.3 Practical recipe

- For a search bar: `GET /api/roms?search_term=<urlencoded>&order_by=&limit=50`.
  The empty `order_by` triggers relevance order. The response is a normal
  page of `SimpleRomSchema`.

---

## 7. Cover art

### 7.1 URL pattern

The `SimpleRomSchema` (and `PlatformSchema`) carries **relative** URLs:

- `path_cover_large` → e.g. `/assets/romm/resources/roms/1234/1234/cover/big.png?ts=2026-05-03T15:21:39.793183+00:00`
- `path_cover_small` → e.g. `/assets/romm/resources/roms/1234/1234/cover/small.png?ts=…`
- `url_cover` → a remote URL (scraped source), if the server has not yet
  resolved to a local cache.

The TV client builds the absolute URL as `RomM base URL` + `path_cover_large`.
The `?ts=` query is a cache-buster, not required.

The frontend code does exactly this (see `frontend/src/v2/composables/useCoverArt/index.ts`):
```
const coverUrl = new URL(path_cover_large, window.location.origin).toString()
```

Confirmed by RomM frontend tests (`resolveRomArtwork` test case):
```
path_cover_large: "/assets/romm/resources/roms/1/1/cover/big.png?ts=x"
→ resolved coverUrl: "/assets/romm/resources/roms/1/1/cover/big.png?ts=x"
```

### 7.2 Cache headers

The bundled nginx serves `/assets/romm/resources/` (this is the directory
where RomM writes cached covers) with a map that picks a header per query
string (`docker/nginx/templates/default.conf.template`):

```
map $args $resources_cache_control {
  default         "public, max-age=3600, must-revalidate";
  "~(^|&)(ts|v)=" "public, max-age=31536000, immutable";
}
```

So:
- Default: `Cache-Control: public, max-age=3600, must-revalidate`.
- When the URL has `?ts=<timestamp>` or `?v=<version>`: `Cache-Control:
  public, max-age=31536000, immutable` (one year).

Recommendation: do **not** strip the `?ts=` query — it's the signal that lets
the browser cache covers for a year after a metadata refresh writes new
bytes to the same filename.

### 7.3 What's actually on disk

`/assets/romm/resources/roms/{rom_id}/{rom_id}/cover/{small|big}.png` is
written by the cover-fetching code on metadata scrape
(`backend/handler/filesystem/resources_handler.py`).

The platform's logo is at a separate field — `PlatformSchema.url_logo` is the
scraped URL; there is no local mirror, the frontend uses `url_logo` directly.

---

## 8. Minimum calls to render the library

Assuming the TV client has a stored Client API Token and wants to show:
1. A list of platforms ("Library" screen).
2. A list of games for one platform.
3. A single game detail (download button).

### Cold start (no cache)

```
1. GET /api/heartbeat
   Authorization: Bearer rmm_…
   → confirms the token works, returns the server's OAuth/config state.
   (Optional but cheap and surfaces "token revoked" / "server in OIDC mode".)

2. GET /api/platforms?updated_after=…  (omit on first run)
   Authorization: Bearer rmm_…
   → list of PlatformSchema, each with rom_count.
   Render: list of platforms; for each, show display_name + rom_count.
```

The platform list rarely changes; cache it client-side and re-fetch when
`updated_after` triggers a delta. To deep-link into a specific platform, use
`GET /api/platforms/{id}` instead of step 2 (or after a refresh).

### Drill into a platform

```
3. GET /api/roms
     ?platform_ids=<platform_id>
     &order_by=name
     &order_dir=asc
     &with_rom_id_index=true
     &with_total=true
     &with_char_index=true
     &with_filter_values=false
     &with_files=false
     &limit=50
     &offset=0
   Authorization: Bearer rmm_…
   → CustomLimitOffsetPage[SimpleRomSchema]
```

The first call asks for the full virtual-scroll index. For a TV that
materialises everything at once, drop `with_rom_id_index=true` and the
limit/offset still gives you a single page; if the library is small enough
to fit in a single response, set `limit` to a high value (e.g. 1000) and you
have everything in one round trip.

For pagination after the first page, send `with_rom_id_index=false` and
`with_total=false` to avoid rescanning the full set on every page
(PR #4062).

### Game detail (only when the user opens a game)

```
4. GET /api/roms/{id}/simple
   Authorization: Bearer rmm_…
   → SimpleRomSchema
   (Drop eager-loaded user_saves/user_states arrays; the gallery card
   already showed everything SimpleRomSchema carries.)
```

`/api/roms/{id}` (returning `DetailedRomSchema`) is heavier and only worth
it if the detail screen needs:
- `user_saves` (own)
- `user_states` (own)
- `user_screenshots`, `all_user_screenshots` (gallery)
- `user_collections`, `all_user_notes`
- `download_formats` (the per-rom format list for the player)

For a TV client that just wants the cover, the description, and a download
button, `/api/roms/{id}/simple` is enough.

### Download (user taps the game)

```
5. GET /api/roms/{id}/content/{anything}
   Authorization: Bearer rmm_…
   → binary ROM stream (Content-Type: application/octet-stream,
     Content-Disposition: attachment; filename="…", Content-Length: …,
     Accept-Ranges: bytes via nginx).
```

Range support is implicit (nginx does it). HEAD the same URL first if you
need the size before committing to the GET.

### Total network round trips: 3 (platforms → roms page → rom simple)
plus 1 for the download when the user actually plays.

The platform list is the only thing that benefits from a cache layer; both
the roms page and the rom detail change frequently and should be fetched
fresh.

---

## 9. Known gaps / open questions

- **RomM 5.4.0 added `with_total=false` opt-out**: a follow-up PR (PR #4062)
  made the count on the first call free when the rom-id index is being
  computed. The TV client doesn't need the optimisation, but be aware that
  earlier docs/posts may describe a slower first page.
- **No documented rate limit** on `/api/roms/*content/*` from the FastAPI
  side. The reverse proxy is the only throttle. If retries are
  exponential, design for a 429 from the reverse proxy and surface a
  human-readable error.
- **Hidden roms** are filtered server-side, returning 404 instead of 403 on
  detail endpoints (per the auth doc). The TV client cannot tell the
  difference between "doesn't exist" and "you can't see it" — and that is
  the intent.
- **OIDC** auth: a Tizen app cannot use the redirect flow. If the RomM
  operator has OIDC-only auth and no Client API Token, the TV client needs
  the device-auth flow (`POST /api/auth/device/init` then
  `POST /api/auth/device/token`). That is its own piece of work — out of
  scope for R2.

---

## 10. Source index

Primary sources used (in order of authority):

1. **OpenAPI spec from the live demo** — `https://demo.romm.app/openapi.json`
   (5.4.0). Authoritative for path + scope + parameter shape.
2. **`rommapp/romm` source on `master`** (SHA captured at fetch time, 2026-10-16).
   - `backend/endpoints/platform.py` — `/api/platforms` route handlers.
   - `backend/endpoints/roms/__init__.py` — `/api/roms`, download, search, etc.
   - `backend/endpoints/roms/files.py` — per-file download.
   - `backend/endpoints/collections.py` — `/api/collections` family.
   - `backend/endpoints/search.py` — `/api/search/roms` and `/api/search/cover`.
   - `backend/endpoints/responses/platform.py`, `responses/rom.py`,
     `responses/collection.py` — response schemas.
   - `backend/handler/database/rom_filters.py` — `RomFilterParams` definition.
   - `backend/handler/auth/constants.py` — scope enum and prefixes.
   - `backend/utils/nginx.py` — `FileRedirectResponse`, `ZipResponse`,
     `content_disposition`.
3. **Official docs** — `https://docs.romm.app/latest/developers/`:
   - `api-authentication/` — auth modes, scope model, errors, CORS.
   - `api-reference/` — OpenAPI pointer, scan endpoint, version policy.
4. **Bundled nginx config** —
   `docker/nginx/templates/default.conf.template` in `rommapp/romm` — covers
   the actual `Cache-Control` headers served to clients.

RomM `5.4.0` release notes — CORS default change:
<https://github.com/rommapp/romm/releases>.
