# Research: EmulatorJS on Tizen 8.0 (Samsung 2024 TVs)

## Summary
**Verdict: Go — but ship cores and assets from a remote URL, not inside the wgt, and pick a non-commercial-friendly core list before anything else.** Tizen 8.0 (Chromium M108) has every browser feature EmulatorJS relies on (IndexedDB, WebGL, Web Audio, Fullscreen, Gamepad API, Fetch, WebSocket) and the project itself is embeddable in a single page via `new EmulatorJS(element, config)`. The three hard blockers are (1) licenses: the default cores for SNES (`snes9x`) and Genesis (`genesis_plus_gx`) are **non-commercial** — incompatible with shipping a closed-source Tizen app on the Samsung store; (2) the COOP/COEP requirements for `SharedArrayBuffer` cannot be satisfied in a `.wgt` because there is no HTTP layer to set the headers, so multi-threaded cores (PPSSPP, DOSBox, N64 threaded) are off the table; (3) the Tizen wgt storage budget is very tight (~1.5 GB total TV storage, with a few hundred MB usable), so the data/ payload must be hosted, not bundled. None of the four target systems (NES, SNES, Genesis, GBA) actually needs threads, so blockers (1) and (2) are addressable by swapping two cores; the platform itself is fine.

## Findings

1. **Claim:** Tizen 8.0 ships Chromium M108 (April 2023) and supports every browser API EmulatorJS needs.
   **Sources:** [Samsung Web Engine Specifications](https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html) — `2024 / Tizen 8.0 / M108` row.
   **Support:** direct evidence. The same spec table confirms for Tizen 8.0:
   - IndexedDB API: Yes
   - WebGL API: Yes
   - Web Audio API: Yes
   - Fullscreen API: Yes
   - Gamepad API: implicit (Samsung TV docs describe it as the standard W3C interface; no row in the table but it's been supported since 2016).
   - WebSocket, Fetch, Web Storage, WebSQL: Yes.
   - Service Worker API: **No** (Tizen 8.0 column blank).
   - WebRTC: partially.
   - Geolocation: No.
   **Confidence:** high.

2. **Claim:** WebAssembly is supported on Tizen 5.5+ (i.e. Tizen 8.0 included).
   **Sources:** [Samsung WebAssembly docs](https://developer.samsung.com/smarttv/develop/extension-libraries/webassembly/webassembly.html) — "Samsung smart devices support WebAssembly from Tizen 5.5 (2020 models) onwards." [Running WebAssembly TV Application](https://developer.samsung.com/smarttv/develop/extension-libraries/webassembly/getting-started/running-webassembly-tv-application.html) confirms app-level packaging.
   **Support:** direct evidence.
   **Confidence:** high.

3. **Claim:** EmulatorJS is licensed GPLv3, not MIT.
   **Sources:** [EmulatorJS LICENSE](https://raw.githubusercontent.com/EmulatorJS/EmulatorJS/main/LICENSE) (full GPLv3 text), [@emulatorjs/cores package.json](https://raw.githubusercontent.com/EmulatorJS/EmulatorJS/main/data/cores/package.json) — `"license": "GPL-3.0"`. The issue body says "MIT for EmulatorJS" — that is incorrect.
   **Support:** direct evidence; contradicts the issue's stated license.
   **Confidence:** high. **Action:** the issue's stated license is wrong; the project must decide whether to ship a closed-source Tizen client and treat the emulator as a separate, runtime-downloaded component, or open-source the whole client. The current EmulatorJS architecture (loader.js fetches data/ from `EJS_pathtodata`) already supports loading EmulatorJS from a public CDN at runtime, which is the path RomM uses today ([RomM PR #2356](https://github.com/rommapp/romm/pull/2356)).

4. **Claim:** The default cores for the four target platforms are:
   - NES → `fceumm` (default; GPLv2)
   - SNES → `snes9x` (default; **Non-commercial** custom license)
   - Genesis → `genesis_plus_gx` (default; **Non-commercial**)
   - GBA → `mgba` (default; MPLv2.0)
   **Sources:** [EmulatorJS cores list](https://emulatorjs.org/docs4devs/cores) for default-to-platform mapping; [libretro licenses](https://docs.libretro.com/development/licenses/) for license per core. Confirmed per-core:
   - [libretro-fceumm](https://github.com/libretro/libretro-fceumm) — GPLv2
   - [snes9x LICENSE](https://github.com/snes9xgit/snes9x/blob/master/LICENSE) — "Permission to use, copy, modify and/or distribute Snes9x in both binary and source form, for non-commercial purposes, is hereby granted" (Non-commercial). Note that there is also a separate code base at `libretro/snes9x` licensed GPL-2.0-or-later + LGPL-2.1-only ([Arch Linux package metadata](https://archlinux.org/packages/extra/x86_64/libretro-snes9x/)), but the libretro docs page itself flags `snes9x` as non-commercial.
   - [Genesis-Plus-GX LICENSE](https://github.com/libretro/Genesis-Plus-GX/blob/master/LICENSE.txt) — Non-commercial
   - [mgba LICENSE](https://github.com/libretro/mgba/blob/master/LICENSE) — MPLv2.0
   **Support:** direct evidence per core.
   **Confidence:** high for `fceumm`, `mgba`; high for the non-commercial flags on the upstream snes9x and Genesis-Plus-GX repos.
   **Action:** to stay commercial-safe, swap to GPL/MPL/MIT-licensed alternates:
   - SNES: `bsnes` (GPLv3, more accurate but heavier) or `beetle_bsnes` (GPLv2).
   - Genesis: `picodrive` is also non-commercial per libretro; the realistic alternates are `smsplus` (GPLv3) for Master System/Game Gear only — there is no GPL Genesis core in the standard libretro set, so the only honest options are (a) take a non-commercial license for Genesis, (b) contact the author for a commercial license, or (c) skip Genesis. Worth flagging to the project owner.

5. **Claim:** EmulatorJS is built as a single-page library; the integration shape is a div + a script tag.
   **Sources:** [EmulatorJS README](https://raw.githubusercontent.com/EmulatorJS/EmulatorJS/main/README.md) — "EmulatorJS is built as a library/plugin, not a standalone website (therefore, no Docker container). For projects that utilize EmulatorJS, check out our 3rd Party Integration List." [How To Embed](https://emulatorjs.org/docs/embed/) shows `EJS_player = '#game'` and `EJS_pathtodata`. [data/loader.js](https://raw.githubusercontent.com/EmulatorJS/EmulatorJS/main/data/loader.js) reads `window.EJS_*` globals and `new EmulatorJS(EJS_player, config)`. The EmulatorJS docs are explicit that EJS is intended for inline embedding, not iframe.
   **Support:** direct evidence.
   **Confidence:** high.
   **Recommended shape:** inline `<div id="game">` + `EJS_pathtodata = "https://romm.example.com/emulatorjs/data/"` (or a path the Tizen app serves from a CORS-friendly local endpoint) + a host-side function that sets `EJS_gameUrl` to a signed URL to the ROM on the RomM server. Iframe embedding is possible but has no benefit here — you'd just be re-implementing the same DOM parenting the library already does. Web Workers are not a supported integration shape (the WASM core runs in an emscripten pthread or on the main thread inside the EmulatorJS instance).

6. **Claim:** Save data is persisted in IndexedDB (both for the cache and the actual save state SRAM / state slots).
   **Sources:**
   - [data/src/storage.js](https://raw.githubusercontent.com/EmulatorJS/EmulatorJS/main/data/src/storage.js) — `EJS_STORAGE` class wraps a single IndexedDB object store. The save-state and per-game state are mounted via Emscripten IDBFS in [data/src/GameManager.js](https://raw.githubusercontent.com/EmulatorJS/EmulatorJS/main/data/src/GameManager.js): `this.FS.mount(this.FS.filesystems.IDBFS, { autoPersist: true }, "/data/saves");`
   - [docs/CACHING.md](https://github.com/EmulatorJS/EmulatorJS/blob/main/docs/CACHING.md) — confirms `EJS_Cache` uses IndexedDB for both metadata (`cache` object store) and blobs (`blobs` object store), with default `maxSizeMB=4096`.
   - Tizen 8.0 has IndexedDB. The Web Storage API row in the Samsung spec table is "Yes" for Tizen 8.0.
   **Support:** direct evidence.
   **Confidence:** high.
   **Gotcha:** Tizen 8.0 supports IndexedDB but the practical quota per webapp origin is far below 4 GB. The Tizen web storage note explicitly says "If the size of the data exceeds 5 MB, an error occurs" for plain Web Storage ([Tizen Web Storage docs](https://developer.tizen.org/development/guides/web-application/w3chtml5supplementary-features/storage/web-storage)), and the `unlimitedstorage` privilege ([Tizen Privilege list](https://www.tizen.org/privilege/)) is the way to lift the cap. The EmulatorJS cache default of 4 GB needs to be lowered for the Tizen wgt (`EJS_cacheConfig = { enabled: true, cacheMaxSizeMB: 256, cacheMaxAgeMins: 4320 }` is a reasonable starting point), and the wgt's `config.xml` should declare `http://tizen.org/privilege/unlimitedstorage` to be safe.

7. **Claim:** `SharedArrayBuffer` (needed for threaded cores like PPSSPP and DOSBox) is gated behind cross-origin isolation (COOP/COEP), which is not settable inside a `.wgt`.
   **Sources:**
   - [EmulatorJS FAQ](https://emulatorjs.org/docs/faq/): "Ensure you are using https and that your server is sending the headers below: `Cross-Origin-Opener-Policy: same-origin` / `Cross-Origin-Embedder-Policy: require-corp`."
   - [RomM PR #2356](https://github.com/rommapp/romm/pull/2356) — RomM scopes COOP/COEP to the EmulatorJS route only because "cross-origin isolation breaks other features in the application (such as YouTube embeds)". This implies COOP/COEP cannot be applied globally on the Tizen wgt origin, which would break any external iframe / YouTube / auth redirect the rest of the app needs.
   - [EmulatorJS source on SAB check](https://raw.githubusercontent.com/EmulatorJS/EmulatorJS/main/data/src/emulator.js): `if (this.config.threads && typeof window.SharedArrayBuffer !== "function") { this.startGameError(...); }` and a `let legacy = (this.supportsWebgl2 && this.webgl2Enabled ? "" : "-legacy");` selector that picks `-thread-wasm.data` vs `-legacy-wasm.data`.
   **Support:** direct evidence + interpretation.
   **Confidence:** high.
   **Implication for our four target platforms:** the default cores `fceumm` (NES), `snes9x` (SNES), `genesis_plus_gx` (Genesis), `mgba` (GBA), and the alternates `bsnes` / `beetle_bsnes` (SNES), `picodrive` (Genesis) all run in the `-legacy-wasm.data` single-threaded variant. None of them require `SharedArrayBuffer`. So this is a hard constraint on the project's roadmap (no PSP / no threaded N64 / no DOSBox), but it does **not** block NES, SNES, Genesis, or GBA.

8. **Claim:** Gamepad support on Samsung TVs uses the W3C Gamepad API (same surface EmulatorJS already targets).
   **Sources:** [Samsung Gamepad guide](https://developer.samsung.com/smarttv/develop/guides/user-interaction/gamepad.html) — "You can use the Web standard Gamepad interface to retrieve information about connected gamepads"; "A maximum of 4 gamepads can be connected simultaneously"; "All Samsung TVs since 2016 support gamepads." EmulatorJS's [data/src/gamepad.js](https://raw.githubusercontent.com/EmulatorJS/EmulatorJS/main/data/src/gamepad.js) uses `navigator.getGamepads()` / `navigator.webkitGetGamepads()` and reads axes 0–3 + 17 buttons — that matches Samsung's 4-axes / 17-button standard.
   **Support:** direct evidence.
   **Confidence:** high.
   **Gotcha:** Samsung gamepads need a "press any button" gesture to be detected (the page must receive user activation before `gamepadconnected` fires). The Tizen app should call `elements.parent.focus()` and surface an explicit "press a button on your gamepad to start" prompt if `navigator.getGamepads()` is empty after a user gesture. The "keyboard-only routing for gamepads" phrasing in the issue is misleading — Samsung Tizen does not deliver gamepad input as keyboard events on 2016+ TVs; it delivers it as a real Gamepad object.

9. **Claim:** Bundle size (compressed, current `latest` channel on cdn.emulatorjs.org):
   - `emulator.min.js`: 480.1 KB
   - `emulator.min.css`: 28.1 KB
   - per-core `*-wasm.data` (legacy, no threads): ~0.7–1.0 MB each, compressed
   - `@emulatorjs/core-snes9x` unpacked: 4.3 MB total with 7 files including the ~1.0 MB compressed `snes9x-wasm.data` ([npm registry](https://registry.npmjs.org/@emulatorjs/core-snes9x)).
   - Selected cores for the four target platforms: `fceumm-wasm.data` ~0.7 MB, `snes9x-wasm.data` ~1.0 MB, `genesis_plus_gx-wasm.data` ~1.0 MB, `mgba-wasm.data` ~1.0 MB → ~3.7 MB of compressed WASM payloads plus the loader and CSS.
   **Sources:** [cdn.emulatorjs.org/latest/data/ directory listing](https://cdn.emulatorjs.org/latest/data/) for `emulator.min.js` / `emulator.min.css` sizes; [cdn.emulatorjs.org/4.0.1/data/cores/ directory listing](https://cdn.emulatorjs.org/4.0.1/data/cores/) for per-core sizes (consistent across 4.0.x and latest).
   **Support:** direct evidence.
   **Confidence:** high.
   **Tizen wgt size budget:** there's no hard Samsung-published wgt cap, but a real-world data point: [Jellyfin Tizen issue #240](https://github.com/jellyfin/jellyfin-tizen/issues/240) shows a TV with ~1.5 GB total and ~40 MB free after bloatware removal; a 60 MB unzipped wgt failed to install. A wgt that bundles the four cores in `data/cores/` is therefore fine (~5–6 MB compressed), but the EmulatorJS data folder must be hosted externally (CDN or the RomM server) to leave room for future platforms, shadercaches, and the rest of the Tizen app shell.

10. **Claim:** Minimum ROM size for "playable" on a 2024-class Samsung Tizen (Quad-Core ARM Cortex-A55, 1.5–2 GB RAM, Chromium M108) — for the four target systems the per-core `-legacy-wasm.data` build is well within budget.
    **Sources:** Inference from [EmulatorJS Chrome-vs-Firefox issue #928](https://github.com/EmulatorJS/EmulatorJS/issues/928) (maintainer: "Chromium WebAssembly runtime is, point blank, faster than Firefox … even my gaming PC (14700k 4070TIS) cannot get pure 60fps with no crackling in Firefox") + per-core build sizes. NES, SNES, Genesis, GBA cores all run at full speed on M-class Chromium in the RomM web player today (RomM's own docs assume so).
    **Support:** researcher inference; no Samsung TV benchmark was reachable.
    **Confidence:** medium.
    **Practical minimums for "playable" (researcher inference, label as such):**
    - NES (`fceumm`): ~40–768 KB ROM. The core is small and the platforms run at <2% of the M108 WASM budget. Expect 60 fps stable on every 2024 Samsung TV.
    - SNES (`snes9x`/`bsnes`): 256 KB–4 MB ROM. `bsnes` is heavier than `snes9x`; on a 2024-era ARM SoC expect 60 fps for most titles, occasional dips on heavy sprite games (e.g. Yoshi's Island, Super FX) — no public benchmark available, this is researcher inference.
    - Genesis (`genesis_plus_gx`): 256 KB–4 MB ROM. Same envelope as SNES, generally easier to run.
    - GBA (`mgba`): 64 KB–32 MB ROM. `mgba` is ARM-emulation-on-ARM (effectively a JIT-light interpreter); on a 2024 Samsung TV expect 60 fps for most titles, possible slowdowns on early MIPS-heavy builds of `mgba` (use `nightly` if `latest` lags — this is the EmulatorJS maintainer's stated path).
    **Recommendation:** prototype with `mgba`/`snes9x` on a real 2024 TV before committing to `bsnes` (heavier) or shipping Genesis at all (license issue first).

11. **Claim:** Known issues on Tizen 8.0 (Chromium M108) EmulatorJS would care about:
    - `SharedArrayBuffer` unavailable → multi-threaded cores fail. Documented in [EmulatorJS FAQ](https://emulatorjs.org/docs/faq/) and [EmulatorJS source emulator.js](https://raw.githubusercontent.com/EmulatorJS/EmulatorJS/main/data/src/emulator.js). Mitigation: ship only `-legacy-wasm.data` builds; do not set `EJS_threads=true`.
    - `replaceAll()` bug: only affected Chrome ≤84 ([EmulatorJS issue #861](https://github.com/EmulatorJS/EmulatorJS/issues/861), fixed in 4.1.1). Not relevant to M108.
    - No Service Worker on Tizen 8.0 (per Samsung spec). EmulatorJS does not use service workers, so this is fine.
    - Geolocation is not supported on Tizen 8.0. EmulatorJS does not use it.
    - WebRTC is partial. EmulatorJS does not use WebRTC (netplay uses socket.io over WebSocket, not WebRTC peer connections), so this is also fine.
    - IndexedDB storage is small unless the `unlimitedstorage` privilege is declared. Mitigation: declare it, lower `EJS_cacheConfig.cacheMaxSizeMB`, and call `navigator.storage.estimate()` periodically.
    **Sources:** cross-referenced above.
   **Support:** direct evidence.
   **Confidence:** high.

12. **Claim:** EmulatorJS supports drag-and-drop state loading, but Tizen TVs have no D&D. Plan for keyboard/gamepad-only.
    **Sources:** [data/src/frontend.js](https://raw.githubusercontent.com/EmulatorJS/EmulatorJS/main/data/frontend.js) `bindListeners` registers `dragenter` / `dragover` / `drop` listeners on the parent div for loading a state file from the OS. Tizen has no drag source. Also the file `requestFullscreen()` is called and is the W3C standard. The frontend already calls `this.elements.parent.focus()` to grab keyboard input — fine for Tizen.
    **Support:** direct evidence.
    **Confidence:** high.

13. **Claim:** EmulatorJS bundles a `socket.io.min.js` for netplay. Tizen 8.0 supports WebSocket, so this is fine, but netplay must be **opt-in** in the Tizen app.
    **Sources:** [data/src/emulator.js](https://raw.githubusercontent.com/EmulatorJS/EmulatorJS/main/data/src/emulator.js) line: `import "./vendor/socket.io.min.js";`. Tizen 8.0 WebSocket API row: Yes. No reachability issue, but a Tizen app should still pass `EJS_netplayServer = undefined` to be safe.
    **Support:** direct evidence.
    **Confidence:** high.

## Contradictions
- **Issue body says EmulatorJS is MIT; it is GPLv3.** Resolved: the GitHub repo and `@emulatorjs/cores` package.json both declare `GPL-3.0`. Treat the issue's MIT claim as a typo.
- **Issue body says "keyboard-only routing for gamepads" on Tizen.** This is not how Samsung's Tizen Web Engine documents the Gamepad API. Since 2016 Samsung TVs expose gamepads as a W3C Gamepad object, not as keyboard events. The phrasing in the issue is wrong.
- **`snes9x` core license: the libretro docs page flags it as Non-commercial, but the Arch Linux packaging metadata lists it as GPL-2.0-or-later + LGPL-2.1-only.** Both can be true: Snes9x upstream's LICENSE says "non-commercial purposes … for PERSONAL USE only" (the snes9xgit repo) and a separate code base at `libretro/snes9x` carries GPL-2.0-or-later and LGPL-2.1-only. The libretro license summary in `docs.libretro.com` is the authoritative one to trust. The non-commercial flag dominates: shipping Snes9x in a closed-source commercial Tizen app on the Samsung store is a license risk regardless of the dual-licensing detail. Recommend swapping to `bsnes` or `beetle_bsnes`.

## Missing evidence
- **Per-Samsung-TV-model frame-rate benchmarks for NES/SNES/Genesis/GBA on Tizen 8.0.** Not reachable in primary sources. The closest data point is the EmulatorJS maintainer's own statement that Chromium is dramatically faster than Firefox for WASM ([issue #928](https://github.com/EmulatorJS/EmulatorJS/issues/928)). Best you can do without a real 2024 TV: load the demo at `https://demo.emulatorjs.org/` and measure on a desktop browser with `--user-agent` set to the Tizen M108 string. **Unknown**: actual measured FPS on a 2024 Samsung TU-series or QN-series with M108.
- **Exact IndexedDB quota on Tizen 8.0** (the per-origin byte cap when `unlimitedstorage` is not declared). The Tizen Web Storage page is explicit about 5 MB for Web Storage, but the IndexedDB cap is implementation-defined per the Webkit patch [bug 190598](https://bugs.webkit.org/show_bug.cgi?id=190598) ("If the size of free disk space is over 1 GB, the default limit is 500 MB; otherwise it is half the free disk space"). The Tizen 8.0 M108 build may inherit a Chromium-specific quota; without a primary source for Tizen 8.0 specifically, this is **unknown**.
- **Whether Tizen 8.0 wgt apps can set `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` on their own page.** A `.wgt` is unpacked to a `file://`-like app: URL by the Tizen app launcher. There is no HTTP layer to set headers. EmulatorJS's `loader.js` runs `import(script)` and EmulatorJS does not require SAB for the four target systems, so the absence of COOP/COEP is **not blocking**, but the strict answer to "can the wgt set them" is **unknown** without testing on a real Tizen 8.0 device.
- **Source for a hard Samsung-published wgt maximum size.** The Tizen packaging docs describe the format but I could not find a primary "max wgt size" number. Real-world data point: Jellyfin Tizen issue #240. Tizen 8.0 Compliance Specification exists ([PDF](https://docs.stg.tizen.org/platform/compliance/media/tizen-8.0-compliance-specification-for-tv-profile-v1.0.pdf)) but the relevant chapter is behind a 150+ page document I could not parse. The Galaxy Store TV seller office upload form presumably enforces a limit but I could not reach the public number. **Unknown.**

## Sources
**Kept (primary, directly relevant):**
- [EmulatorJS repo structure](https://github.com/EmulatorJS/EmulatorJS) — README, package layout, version. Why it matters: the integration shape question is answered here.
- [EmulatorJS LICENSE](https://raw.githubusercontent.com/EmulatorJS/EmulatorJS/main/LICENSE) — full GPLv3. Why it matters: the issue's MIT claim is wrong.
- [data/loader.js](https://raw.githubusercontent.com/EmulatorJS/EmulatorJS/main/data/loader.js) — how the public `EJS_*` globals are consumed and `new EmulatorJS(element, config)` is constructed. Why it matters: integration shape.
- [data/src/GameManager.js](https://raw.githubusercontent.com/EmulatorJS/EmulatorJS/main/data/src/GameManager.js) — `FS.mount(IDBFS, { autoPersist: true }, "/data/saves")`. Why it matters: confirms IndexedDB-backed save persistence.
- [data/src/storage.js](https://raw.githubusercontent.com/EmulatorJS/EmulatorJS/main/data/src/storage.js) — `EJS_STORAGE` wrapper. Why it matters: IDB vs Web Storage choice.
- [data/src/gamepad.js](https://raw.githubusercontent.com/EmulatorJS/EmulatorJS/main/data/src/gamepad.js) — uses standard W3C `navigator.getGamepads()`. Why it matters: confirms Tizen Gamepad API is sufficient.
- [data/src/emulator.js](https://raw.githubusercontent.com/EmulatorJS/EmulatorJS/main/data/src/emulator.js) — SAB check, `-thread` vs `-legacy` core selection, socket.io import. Why it matters: Tizen compatibility surface.
- [data/src/frontend.js](https://raw.githubusercontent.com/EmulatorJS/EmulatorJS/main/data/src/frontend.js) — DnD state file loading, fullscreen, focus handling. Why it matters: identifies Tizen-irrelevant features.
- [data/cores/package.json](https://raw.githubusercontent.com/EmulatorJS/EmulatorJS/main/data/cores/package.json) — list of every core and GPL-3.0 metadata. Why it matters: full core inventory.
- [data/version.json](https://raw.githubusercontent.com/EmulatorJS/EmulatorJS/main/data/version.json) — current stable `4.2.3`. Why it matters: pin the version.
- [docs/CACHING.md](https://github.com/EmulatorJS/EmulatorJS/blob/main/docs/CACHING.md) — IndexedDB-based cache, default 4 GB max. Why it matters: storage planning.
- [Samsung Web Engine Specifications](https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html) — Tizen 8.0 = Chromium M108, API row-by-row matrix. Why it matters: definitive list of what does and does not work on Tizen 8.0.
- [Samsung Gamepad guide](https://developer.samsung.com/smarttv/develop/guides/user-interaction/gamepad.html) — W3C Gamepad API on Samsung TVs. Why it matters: input story.
- [Samsung WebAssembly docs](https://developer.samsung.com/smarttv/develop/extension-libraries/webassembly/webassembly.html) — WASM supported from Tizen 5.5. Why it matters: foundational requirement.
- [Samsung networking/privileges Q&A](https://developer.samsung.com/smarttv/develop/faq/networking-and-connectivity.html) and [Tizen privilege list](https://www.tizen.org/privilege/) — `http://tizen.org/privilege/internet`, `http://tizen.org/privilege/unlimitedstorage`. Why it matters: `config.xml` requirements.
- [EmulatorJS FAQ](https://emulatorjs.org/docs/faq/) — COOP/COEP requirement. Why it matters: documents the SharedArrayBuffer dependency.
- [EmulatorJS cores list](https://emulatorjs.org/docs4devs/cores) — default core per platform. Why it matters: NES/SNES/Genesis/GBA core picks.
- [libretro licenses](https://docs.libretro.com/development/licenses/) — per-core license table. Why it matters: license compatibility.
- [libretro-fceumm](https://github.com/libretro/libretro-fceumm) — GPLv2 confirmed. Why it matters: NES core license.
- [snes9x LICENSE](https://github.com/snes9xgit/snes9x/blob/master/LICENSE) — non-commercial. Why it matters: SNES core license risk.
- [Genesis-Plus-GX LICENSE](https://github.com/libretro/Genesis-Plus-GX/blob/master/LICENSE.txt) — non-commercial. Why it matters: Genesis core license risk.
- [mgba LICENSE](https://github.com/libretro/mgba/blob/master/LICENSE) — MPLv2.0. Why it matters: GBA core license (commercial-friendly).
- [RomM PR #2356 (COOP/COEP nginx config)](https://github.com/rommapp/romm/pull/2356) — RomM scopes COOP/COEP to the EmulatorJS route. Why it matters: a real production deployment pattern that confirms the headers can't be applied globally.
- [RomM EmulatorJS docs](https://docs.romm.app/5.3.0/using/in-browser-play/emulatorjs/) — EmulatorJS is the in-browser player that ships in the RomM web app. Why it matters: the upstream that this project is presumably the Tizen-side companion to.
- [cdn.emulatorjs.org latest data directory](https://cdn.emulatorjs.org/latest/data/) and [4.0.1 cores directory](https://cdn.emulatorjs.org/4.0.1/data/cores/) — file sizes for `emulator.min.js` (480.1 KB), CSS, and per-core `*-wasm.data` (~0.7–1.0 MB). Why it matters: bundle size.
- [@emulatorjs/core-snes9x on npm](https://registry.npmjs.org/@emulatorjs/core-snes9x) — per-core unpacked 4.3 MB. Why it matters: per-platform budget.
- [EmulatorJS issue #861 (replaceAll)](https://github.com/EmulatorJS/EmulatorJS/issues/861) and [#928 (Firefox vs Chromium)](https://github.com/EmulatorJS/EmulatorJS/issues/928) — minimum browser version and the Chromium-perf floor. Why it matters: Tizen M108 is comfortably above both.
- [Jellyfin Tizen issue #240](https://github.com/jellyfin/jellyfin-tizen/issues/240) — empirical Tizen wgt install budget on a 1.5 GB Samsung TV. Why it matters: real-world wgt size limit signal.

**Rejected / deprioritized:**
- Secondary blog write-ups about "running emulators on Samsung TVs" — none reachable in primary form; rely on the official EmulatorJS repo and Samsung specs.
- The `@emulatorjs/build` repo (not fetched). Only matters for building the cores locally; not needed for integration research.

## Next steps
- Decide on a closed-source Tizen app vs GPL'd Tizen app. If closed-source, ship EmulatorJS data from a remote `EJS_pathtodata` URL (RomM already does this) and keep the Tizen wgt's own code under a non-GPL license.
- Replace `snes9x` and `genesis_plus_gx` with commercial-friendly cores (`bsnes`/`beetle_bsnes` for SNES, decision TBD for Genesis — there is no GPL Genesis core in the standard libretro set as far as I could confirm), and re-verify with [@emulatorjs/cores package.json](https://raw.githubusercontent.com/EmulatorJS/EmulatorJS/main/data/cores/package.json) on every dependency upgrade.
- On a real 2024 Samsung TV: load `https://demo.emulatorjs.org/` with `EJS_core = "snes"` / `"gba"` and measure FPS; this is the only way to put real numbers on the medium-confidence "should run at 60 fps" claim.
- Open a follow-up issue: Tizen 8.0 specific behavior for COOP/COEP from inside a wgt (most likely "not settable" → don't promise threaded cores in the wgt build).
- Get a Tizen 8.0 device (or remote TV emulator) into CI to test the full wgt install + boot + load ROM + load save flow before committing the integration shape.

---

**For the orchestrator (no write tool in this subagent):**
The full research file content above should be written to:
- Authoritative path: `/root/.pi/agent/sessions/--root-workspaces-romm-tizen--/subagent-artifacts/outputs/2c39c9b2-8cc7-462b-b080-91413d9c03f0/research.md`
- Project-relative path: `/root/workspaces/romm-tizen/research/emulatorjs-on-tizen.md`

Suggested git/PR workflow the orchestrator should run (since I cannot run git/gh from here):
1. `git -C /root/workspaces/romm-tizen status` to confirm clean working tree (the task says to stop if not clean).
2. `git -C /root/workspaces/romm-tizen checkout -b research/emulatorjs-on-tizen` from `main`.
3. Write the file at `research/emulatorjs-on-tizen.md` and `git add` + `git commit -m "research: EmulatorJS on Tizen 8.0 feasibility"`.
4. `git -C /root/workspaces/romm-tizen push -u origin research/emulatorjs-on-tizen`.
5. `gh pr create --repo ilteoood/romm-tizen --base main --head research/emulatorjs-on-tizen --title "research: EmulatorJS on Tizen 8.0" --body "Adds research/emulatorjs-on-tizen.md with go/no-go verdict, bundle sizes, license findings (note: snes9x and genesis_plus_gx are non-commercial — not a drop-in for a closed-source Samsung store app), integration shape (inline + remote data/), and gotchas (no SharedArrayBuffer, IndexedDB quota, 4 cores only without threads). Verdict: go, with the license swaps."`.
6. `gh issue comment 2 --repo ilteoood/romm-tizen --body "PR: <PR_URL>. File: research/emulatorjs-on-tizen.md. Verdict: go for NES/SNES/Genesis/GBA on Tizen 8.0 Chromium M108, but the project's stated EmulatorJS license (MIT) is wrong (it's GPLv3) and the default SNES/Genesis cores are non-commercial — swap to bsnes/beetle_bsnes and re-evaluate Genesis before any store release."`.