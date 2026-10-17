import { loadCredentials } from "../storage/store";
import { RomMClient, type SaveEntry, type SimpleRom, type StateEntry } from "../api/romm";
import { extractCoverTs, getCachedCover, storeCover } from "../storage/box-art";
import { romsStorage } from "../storage/roms";
import { setCachedSaveStateList } from "../storage/save-states";
import { activateFocusList } from "./focus";

const SAVE_LIST_VISIBLE_LIMIT = 20;

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(d);
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " ");
  }
}

type SaveOrState = { label: string; updatedAt: string };

function entryLabel(entry: SaveEntry | StateEntry): string {
  return entry.file_name_no_tags ?? entry.file_name ?? "Untitled";
}

function renderSaveStates(
  container: HTMLElement,
  saves: SaveEntry[],
  states: StateEntry[],
): void {
  container.replaceChildren();
  const autosave = saves.find((s) => s.slot === "autosave");
  const other: SaveOrState[] = [
    ...saves.filter((s) => s.slot !== "autosave").map((s) => ({ label: entryLabel(s), updatedAt: s.updated_at })),
    ...states.map((s) => ({ label: entryLabel(s), updatedAt: s.updated_at })),
  ];
  // shortcut: sort by updated_at for stability (rename doesn't move the row); created_at would also work.
  other.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

  if (!autosave && other.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No save states yet.";
    container.appendChild(empty);
    return;
  }

  const list = document.createElement("div");
  list.className = "save-list";

  if (autosave) {
    const row = document.createElement("div");
    row.className = "entry is-autosave";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = "Autosave";
    const when = document.createElement("span");
    when.className = "when";
    when.textContent = formatTimestamp(autosave.updated_at);
    row.append(name, when);
    list.appendChild(row);
  }

  const visible = other.slice(0, SAVE_LIST_VISIBLE_LIMIT);
  for (const entry of visible) {
    const row = document.createElement("div");
    row.className = "entry";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = entry.label;
    const when = document.createElement("span");
    when.className = "when";
    when.textContent = formatTimestamp(entry.updatedAt);
    row.append(name, when);
    list.appendChild(row);
  }

  if (other.length > SAVE_LIST_VISIBLE_LIMIT) {
    const more = document.createElement("div");
    more.className = "more";
    more.textContent = `+ ${other.length - SAVE_LIST_VISIBLE_LIMIT} more`;
    list.appendChild(more);
  }

  container.appendChild(list);
}

function renderSaveStatesError(
  container: HTMLElement,
  savesError: string | null,
  statesError: string | null,
): void {
  container.replaceChildren();
  if (savesError && statesError) {
    const msg = document.createElement("p");
    msg.className = "empty";
    msg.textContent = `Failed to load save states: ${savesError}`;
    container.appendChild(msg);
    return;
  }
  if (savesError) {
    const msg = document.createElement("p");
    msg.className = "empty";
    msg.textContent = `SRAM list unavailable: ${savesError}`;
    container.appendChild(msg);
  }
  if (statesError) {
    const msg = document.createElement("p");
    msg.className = "empty";
    msg.textContent = `Snapshot list unavailable: ${statesError}`;
    container.appendChild(msg);
  }
}

export function renderGameDetail(
  root: HTMLElement,
  romId: number,
  onBack: () => void,
  onPlay: (romId: number) => void,
): void {
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
          <div data-save-list></div>
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
  const saveListEl = screen.querySelector<HTMLElement>("[data-save-list]")!;

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

  // shortcut: the panel is read-only. The in-game overlay slice adds the Load... picker
  //            and the "Play auto-loads the autosave slot" behaviour (D8 follow-on).
  async function loadSaveStates(id: number): Promise<void> {
    const [savesResult, statesResult] = await Promise.allSettled([
      client.listSaves(id),
      client.listStates(id),
    ]);
    const saves = savesResult.status === "fulfilled" ? savesResult.value : null;
    const states = statesResult.status === "fulfilled" ? statesResult.value : null;
    const savesError = savesResult.status === "rejected" ? errorMessage(savesResult.reason) : null;
    const statesError = statesResult.status === "rejected" ? errorMessage(statesResult.reason) : null;

    if (saves && states) {
      renderSaveStates(saveListEl, saves, states);
      void setCachedSaveStateList({ romId: id, saves, states, fetchedAt: Date.now() });
      return;
    }
    renderSaveStatesError(saveListEl, savesError, statesError);
  }

  async function startPlay(): Promise<void> {
    if (!currentRom || activeController) return;
    const rom = currentRom;
    const meta = await romsStorage.metadata(rom.id);
    if (meta) {
      cleanupFocus();
      onPlay(rom.id);
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
      cleanupFocus();
      onPlay(rom.id);
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
      void loadSaveStates(romId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      titleEl.textContent = "Could not load game";
      summaryEl.textContent = message;
      setStatus(`Failed: ${message}`);
    }
  })();
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Unknown error";
}
