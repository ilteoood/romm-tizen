import { loadCredentials } from "../storage/store";
import { RomMClient, type SimpleRom } from "../api/romm";
import { extractCoverTs, getCachedCover, storeCover } from "../storage/box-art";
import { romsStorage } from "../storage/roms";
import { activateFocusList } from "./focus";

export function renderGameDetail(root: HTMLElement, romId: number, onBack: () => void): void {
  const credentials = loadCredentials();
  if (!credentials) {
    onBack();
    return;
  }
  const client = new RomMClient(credentials);

  root.replaceChildren();
  const screen = document.createElement("section");
  screen.className = "screen game-detail";
  screen.innerHTML = `
    <button class="back-btn" data-action="back" aria-label="Back" tabindex="0">&larr; Library</button>
    <div class="game-detail-layout">
      <div class="cover-large" data-cover-wrap>
        <img alt="" data-cover />
      </div>
      <div class="info">
        <h1 data-title></h1>
        <p class="platform" data-platform></p>
        <p class="summary" data-summary></p>
        <button class="play-btn" data-action="play" aria-label="Play" tabindex="0" data-autofocus>Play</button>
        <p class="download-status" data-status>Loading…</p>
        <section class="save-states">
          <h2>Save states</h2>
          <p class="empty">No save states yet.</p>
        </section>
      </div>
    </div>
  `;
  root.appendChild(screen);

  const playBtn = screen.querySelector<HTMLButtonElement>("[data-action='play']")!;
  const titleEl = screen.querySelector<HTMLElement>("[data-title]")!;
  const platformEl = screen.querySelector<HTMLElement>("[data-platform]")!;
  const summaryEl = screen.querySelector<HTMLElement>("[data-summary]")!;
  const statusEl = screen.querySelector<HTMLElement>("[data-status]")!;
  const coverImg = screen.querySelector<HTMLImageElement>("[data-cover]")!;

  let currentRom: SimpleRom | null = null;
  let activeController: AbortController | null = null;

  const focusable = (): HTMLButtonElement[] =>
    Array.from(screen.querySelectorAll<HTMLButtonElement>("button[tabindex]:not([tabindex='-1'])"))
      .filter((el) => !el.hidden && !el.disabled);

  const cleanupFocus = activateFocusList({
    items: focusable,
    onSelect: (item) => {
      const action = item.dataset.action;
      if (action === "back") {
        triggerBack();
        return;
      }
      if (action === "play") {
        void startPlay();
      }
    },
    onBack: () => {
      triggerBack();
    },
  });

  function triggerBack(): void {
    if (activeController) {
      activeController.abort();
    }
    cleanupFocus();
    onBack();
  }

  function setStatus(text: string): void {
    statusEl.textContent = text;
  }

  function loadCover(rom: SimpleRom): void {
    const relativePath = rom.path_cover_large;
    if (!relativePath) return;
    const ts = extractCoverTs(relativePath);
    void (async () => {
      const cached = await getCachedCover(rom.id, ts);
      if (cached) {
        coverImg.src = URL.createObjectURL(cached);
        return;
      }
      try {
        const response = await client.fetchCoverArt(relativePath);
        if (!response.ok) return;
        const blob = await response.blob();
        void storeCover(rom.id, ts, blob);
        coverImg.src = URL.createObjectURL(blob);
      } catch {
        // Gradient placeholder remains.
      }
    })();
  }

  async function startPlay(): Promise<void> {
    if (!currentRom || activeController) return;
    const rom = currentRom;
    const meta = await romsStorage.metadata(rom.id);
    if (meta) {
      setStatus("Starting emulator…");
      // shortcut: emulator launch is the next slice; the loader will replace this.
      console.log("play", { romId: rom.id, fsName: rom.fs_name, ext: rom.fs_extension });
      return;
    }
    const controller = new AbortController();
    activeController = controller;
    playBtn.disabled = true;
    setStatus("Downloading…");
    // shortcut: blob() waits for the whole body; mid-download progress is not shown. Upgrade when a real progress bar is needed.
    try {
      const fileName = `${rom.fs_name_no_ext}.${rom.fs_extension}`;
      const response = await client.downloadRom(rom.id, fileName, controller.signal);
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
      }
      const blob = await response.blob();
      await romsStorage.save(rom.id, blob, {
        romId: rom.id,
        fsName: rom.fs_name,
        ext: rom.fs_extension,
        size: blob.size,
        updatedAt: new Date().toISOString(),
        crcHash: null,
      });
      setStatus("Ready");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setStatus("Cancelled");
      } else {
        const message = err instanceof Error ? err.message : "Unknown error";
        setStatus(`Failed: ${message}`);
      }
    } finally {
      activeController = null;
      playBtn.disabled = false;
    }
  }

  void (async () => {
    try {
      const [rom, meta] = await Promise.all([
        client.getRom(romId),
        romsStorage.metadata(romId),
      ]);
      currentRom = rom;
      titleEl.textContent = rom.name;
      platformEl.textContent = rom.platform_display_name;
      summaryEl.textContent = rom.summary;
      loadCover(rom);
      setStatus(meta ? "Ready" : "Not downloaded");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      titleEl.textContent = "Could not load game";
      summaryEl.textContent = message;
      setStatus(`Failed: ${message}`);
    }
  })();
}
