# RomM for Tizen

A Samsung Tizen TV client for [RomM](https://romm.app), the self-hosted ROM manager.

This is the **streaming client**: a TV-native shell that browses your RomM library and launches games through the official RomM streaming container (Selkies WebRTC).

This is **not** a port of [Grout](https://github.com/rommapp/grout). Grout transfers ROMs to a device and lets a local emulator play them — Tizen TVs have no usable native emulator, so Grout's model does not apply. The closest analogy is "Steam Link for RomM".

## Status

- [x] Project skeleton (Vite + TypeScript, Tizen Web App manifest)
- [ ] RomM REST client (Client API Token auth)
- [ ] TV remote input (`TVInputDevice` with keyboard fallback)
- [ ] Library browser (platforms → game grid → detail)
- [ ] Game launch via `romm-broker` + Selkies iframe
- [ ] Save state list/load via broker endpoints
- [ ] Local box-art cache

## Build

```bash
npm install
npm run build
```

The build writes static assets to `dist/`. `config.xml` points the Tizen entry at `dist/index.html`, so you must run `npm run build` before packaging.

`npm run dev` starts Vite locally for browser testing. Note: browser dev is not a substitute for the Tizen emulator — `TVInputDevice` and the packaging pipeline are Tizen-only.

## Install on a TV

1. Install Tizen Studio 6.x and the TV Extension 10.0.
2. **File → Import → Tizen Project** and point it at this folder. Tizen Studio will read the existing `config.xml`.
3. On the TV: **Apps → Settings (gear) → All Settings → Connection → Expert Settings → Developer Mode → On**. Note the IP the TV shows.
4. In Tizen Studio, set the TV's IP as the **Target** (Connection Explorer).
5. **Project → Build Signed Package**, then **Run** to install. The app appears on the TV's home screen.
6. First launch: enter your RomM server URL and a Client API Token, then pair.

A Client API Token is created in the RomM web UI under **Settings → Security → Client API Tokens**, with the scopes the TV needs (`platforms.read`, `roms.read`, `roms.play`, `saves.read`, `saves.write`).

## TV compatibility

| TV year | Tizen | Chromium | Works? |
|---|---|---|---|
| 2026 | 10.0 | M130 | ✓ |
| 2025 | 9.0 | M120 | ✓ |
| 2024 | 8.0 | M108 | ✓ |
| 2023 | 7.0 | M94 | ✓ |
| 2022 | 6.5 | M85 | ✓ (basic WebCodecs) |
| 2021 | 6.0 | M76 | ⚠ Selkies may struggle |
| ≤2020 | ≤5.5 | ≤M69 / WebKit | ✗ |

Source: [Samsung Web Engine Specifications](https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html).

## Known limits

- **No gamepad over WebHID on Tizen.** Bluetooth controllers are not exposed as WebHID; the TV routes them as keyboard arrows only. Any D-pad-only control scheme is fine; analog-stick games are not.
- **One RomM user, one TV at a time.** The broker's room model is single-session.
- **No local ROM playback.** Every game is streamed from the RomM webstation container. The host needs a GPU, and the network round-trip adds latency.
- **No store distribution yet.** Sideload only. Seller Office submission is a later step.

## Architecture

```
src/
  main.ts          entry, mounts the root screen
  styles.css       10-foot base, focus styles land here later
config.xml         Tizen Web App manifest
dist/              Vite build output (created by `npm run build`)
```

Feature branches will add:
- `src/api/romm.ts`     typed REST client for RomM
- `src/api/broker.ts`   broker activate / save-state endpoints
- `src/storage/...`     token + box-art cache
- `src/input/remote.ts` TVInputDevice wrapper
- `src/ui/...`          sign-in, library, game detail, play overlay

## Upstream

- [RomM](https://romm.app) — server, API spec, demo
- [RomM API docs](https://docs.romm.app/latest/) — REST reference
- [romm-broker](https://romm-streaming.github.io/romm-broker/) — streaming session broker
- [Grout](https://github.com/rommapp/grout) — official Linux/handheld client (transfer model, not applicable here)
- [Selkies](https://docs.selkies.io/) — the WebRTC streaming layer we embed for gameplay
- [Samsung TV developer](https://developer.samsung.com/smarttv/develop/getting-started/quick-start-guide.html) — Tizen web platform reference
