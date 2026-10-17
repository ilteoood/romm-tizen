# RomM for Tizen

A Samsung Tizen TV client for [RomM](https://romm.app), the self-hosted ROM manager.

Plays ROMs locally in an embedded JS emulator. No host machine required.

The TV pairs with a self-hosted RomM server via a Client API Token, downloads a selected ROM, and runs it in an [EmulatorJS](https://emulatorjs.org/)-driven emulator rendered in the browser. NES, SNES, Genesis, and GBA are in scope for the MVP. Save state and SRAM are synced with RomM the same way the official clients do it. The host machine is only used to run the RomM server itself; nothing on it has to be awake or have a GPU while the TV is playing.

This is **not** a port of [Grout](https://github.com/rommapp/grout). Grout's model (transfer the ROM to a separate device, let a local emulator play it) doesn't fit a TV either, but the reason is different now: the TV has EmulatorJS embedded, so the transfer step is unnecessary. Selkies, romm-broker, and WebRTC streaming are intentionally not in the design.

## Status

- [x] Project skeleton (Vite + TypeScript, Tizen Web App manifest)
- [ ] RomM REST client (`src/api/romm.ts`, Client API Token auth)
- [ ] Sign-in flow (`src/ui/sign-in.ts`)
- [ ] Library browser (`src/ui/library.ts` — platforms → game grid)
- [x] Game detail + ROM download (`src/api/romm.ts` content endpoint, `src/storage/roms.ts`)
- [x] Box-art cache (`src/storage/box-art.ts`)
- [x] EmulatorJS harness (`src/emulator/`, NES/SNES/Genesis/GBA cores)
- [x] Save-state sync (`src/storage/save-states.ts` + `/api/saves*` and `/api/states*`)
- [ ] In-game play overlay (`src/ui/play-overlay.ts`)
- [ ] Verified on a real Samsung TV (2024 model)

## Build

```bash
npm install
npm run build
```

The build writes static assets to `dist/`. `config.xml` points the Tizen entry at `dist/index.html`, so you must run `npm run build` before packaging.

`npm run dev` starts Vite locally for browser testing. Note: browser dev is not a substitute for the Tizen emulator — `TVInputDevice`, the wgt storage budget, and the packaging pipeline are Tizen-only.

## Install on a TV

1. Install Tizen Studio 6.x and the TV Extension 10.0.
2. **File → Import → Tizen Project** and point it at this folder. Tizen Studio will read the existing `config.xml`.
3. On the TV: **Apps → Settings (gear) → All Settings → Connection → Expert Settings → Developer Mode → On**. Note the IP the TV shows.
4. In Tizen Studio, set the TV's IP as the **Target** (Connection Explorer).
5. **Project → Build Signed Package**, then **Run** to install. The app appears on the TV's home screen.
6. First launch: enter your RomM server URL and a Client API Token, then pair.

A Client API Token is created in the RomM web UI under **Settings → Security → Client API Tokens**, with the scopes the TV needs (`platforms.read`, `roms.read`, `assets.read`, `saves.read`, `saves.write`, `states.read`, `states.write`).

## TV compatibility

| TV year | Tizen | Chromium | Works? |
|---|---|---|---|
| 2026 | 10.0 | M130 | ✓ |
| 2025 | 9.0 | M120 | ✓ |
| 2024 | 8.0 | M108 | ✓ |
| 2023 | 7.0 | M94 | ✗ below platform floor |
| 2022 | 6.5 | M85 | ✗ below platform floor |
| 2021 | 6.0 | M76 | ✗ below platform floor |
| ≤2020 | ≤5.5 | ≤M69 / WebKit | ✗ |

The MVP targets Tizen 8.0 (2024+) only. Older Tizen is out of scope — see the [wayfinder map](https://github.com/ilteoood/romm-tizen/issues/1) for why.

Source: [Samsung Web Engine Specifications](https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html).

## Known limits

- **Platform floor is Tizen 8.0 (2024+).** Older Tizen releases ship a Chromium that lacks APIs the EmulatorJS harness and the IndexedDB-backed storage rely on.
- **No host machine required.** The RomM server can be on the same network as the TV and nothing else; nothing on it has to stream, transcode, or have a GPU.
- **No streaming, no broker.** Selkies and romm-broker are out of the design. The TV plays the ROM itself; there is no WebRTC path.
- **D-pad only.** Tizen exposes Bluetooth controllers as keyboard arrows. EmulatorJS's on-screen gamepad is the fallback for anything the D-pad can't reach. Analog-stick games are out of MVP scope. Back press on the play screen currently triggers direct emulator teardown. The D8 in-game overlay (Resume / Save / Save as... / Load... / Exit) is a follow-on slice.
- **The in-game overlay (Resume / Save / Save as... / Load... / Exit) and the "Play auto-loads the autosave slot" behaviour are a follow-on slice.** The game-detail panel currently shows the save-state list read-only.
- **One RomM user, one TV at a time.** A single Client API Token is stored in the app; pairing again with a new server overwrites it.
- **MVP scope ends at "code-complete + emulator-tested".** The destination says "verified on a real TV", but real-TV verification is a final user step (or a separate effort if no TV is available in the development environment). The repository may declare an MVP done before that step is checked off.
- **No store distribution yet.** Sideload only. Seller Office submission is a later step.

## Architecture

```
src/
  main.ts          entry, mounts the root screen
  styles.css       10-foot base, focus styles land here later
config.xml         Tizen Web App manifest
dist/              Vite build output (created by `npm run build`)
```

Feature branches add:

- `src/api/romm.ts`        typed REST client for RomM (platforms, roms, content, saves, states)
- `src/storage/roms.ts`         downloaded ROM cache (Tizen app-private storage)
- `src/storage/box-art.ts`      cover-art cache
- `src/storage/save-states.ts`  save-state metadata cache (D1 sync, D8 read-only panel)
- `src/emulator/`               D5 EmulatorJS integration (loader, boot, data-path resolution)
- `src/input/remote.ts`         `TVInputDevice` wrapper, keyboard fallback
- `src/ui/sign-in.ts`           server URL + token entry
- `src/ui/library.ts`           platform list → game grid
- `src/ui/game-detail.ts`       per-game screen, launch + save-state list
- `src/ui/play.ts`              play screen (EmulatorJS mount, Back = teardown)
- `src/ui/play-overlay.ts`      in-game pause / save / load / exit

The current scaffold (`main.ts`, `styles.css`, `config.xml`) is the only code on `main` today; the rest is implemented on the feature branches named in the Status section above.

## Upstream

- [RomM](https://romm.app) — server, API spec, demo
- [RomM API docs](https://docs.romm.app/latest/) — REST reference
- [EmulatorJS](https://emulatorjs.org/) — the in-browser emulator we embed
- [Grout](https://github.com/rommapp/grout) — official Linux/handheld client (transfer model, not applicable here)
- [Samsung TV developer](https://developer.samsung.com/smarttv/develop/getting-started/quick-start-guide.html) — Tizen web platform reference

See the [wayfinder map](https://github.com/ilteoood/romm-tizen/issues/1) for the destination, the decisions taken so far, and the open questions that haven't become tickets yet.
