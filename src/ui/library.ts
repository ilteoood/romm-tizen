import { clearCredentials, loadCredentials } from "../storage/store";
import { RomMClient, type Platform, type SimpleRom } from "../api/romm";
import { extractCoverTs, getCachedCover, storeCover } from "../storage/box-art";
import { activateFocusList } from "./focus";

const ROMS_PER_PLATFORM = 200;

export function renderLibrary(root: HTMLElement, onSignOut: () => void): void {
  const credentials = loadCredentials();
  if (!credentials) {
    onSignOut();
    return;
  }
  const client = new RomMClient(credentials);

  root.replaceChildren();
  const screen = document.createElement("section");
  screen.className = "screen library";
  screen.innerHTML = `
    <div class="library-layout">
      <nav class="left-rail" data-platforms aria-label="Platforms"></nav>
      <div class="right-pane">
        <div class="search-row">
          <button class="icon-btn" data-action="search" aria-label="Search" tabindex="0">&#x2315;</button>
          <button class="icon-btn" data-action="signout" aria-label="Sign out" tabindex="0">&#x1F511;</button>
        </div>
        <h1 data-title></h1>
        <h3 data-count></h3>
        <div class="game-grid" data-games role="list"></div>
        <p class="status" data-status></p>
      </div>
    </div>
  `;
  root.appendChild(screen);

  const platformsEl = screen.querySelector<HTMLElement>("[data-platforms]")!;
  const titleEl = screen.querySelector<HTMLElement>("[data-title]")!;
  const countEl = screen.querySelector<HTMLElement>("[data-count]")!;
  const gamesEl = screen.querySelector<HTMLElement>("[data-games]")!;
  const statusEl = screen.querySelector<HTMLElement>("[data-status]")!;

  let platforms: Platform[] = [];
  let currentPlatformId: number | null = null;

  const focusable = (): HTMLElement[] =>
    Array.from(screen.querySelectorAll<HTMLElement>("[tabindex]:not([tabindex='-1'])"))
      .filter((el) => !el.hidden);

  const cleanupFocus = activateFocusList({
    items: focusable,
    onSelect: (item) => {
      const platformId = item.dataset.platformId;
      if (platformId) {
        const platform = platforms.find((p) => p.id === Number(platformId));
        if (platform) {
          highlightPlatform(platform.id);
          void refreshGames(platform);
        }
        return;
      }
      const action = item.dataset.action;
      if (action === "signout") {
        cleanupFocus();
        clearCredentials();
        onSignOut();
      }
    },
    onBack: () => {},
  });

  function highlightPlatform(id: number): void {
    for (const el of platformsEl.querySelectorAll<HTMLElement>(".platform")) {
      el.classList.toggle("is-focused", Number(el.dataset.platformId) === id);
    }
  }

  function renderPlatforms(items: Platform[]): void {
    platformsEl.replaceChildren();
    for (const platform of items) {
      const entry = document.createElement("div");
      entry.className = "platform";
      entry.tabIndex = 0;
      entry.dataset.platformId = String(platform.id);
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = platform.display_name;
      const count = document.createElement("span");
      count.className = "count";
      count.textContent = String(platform.rom_count);
      entry.append(name, count);
      if (currentPlatformId === platform.id) entry.classList.add("is-focused");
      platformsEl.appendChild(entry);
    }
  }

  function renderGames(roms: SimpleRom[]): void {
    gamesEl.replaceChildren();
    for (const rom of roms) {
      const card = document.createElement("div");
      card.className = "cover";
      card.tabIndex = 0;
      card.dataset.romId = String(rom.id);
      card.dataset.romName = rom.name;
      card.setAttribute("role", "listitem");
      const img = document.createElement("img");
      img.alt = "";
      img.loading = "lazy";
      card.appendChild(img);
      const label = document.createElement("div");
      label.className = "label";
      label.textContent = rom.name;
      card.appendChild(label);
      const ts = extractCoverTs(rom.path_cover_large);
      void loadCover(client, rom, ts, img);
      gamesEl.appendChild(card);
    }
  }

  async function refreshGames(platform: Platform): Promise<void> {
    currentPlatformId = platform.id;
    titleEl.textContent = platform.display_name;
    countEl.textContent = `${platform.rom_count} game${platform.rom_count === 1 ? "" : "s"}`;
    gamesEl.replaceChildren();
    statusEl.textContent = "Loading…";
    try {
      const page = await client.listRoms({
        platformIds: [platform.id],
        limit: ROMS_PER_PLATFORM,
        orderBy: "name",
        orderDir: "asc",
      });
      renderGames(page.items);
      statusEl.textContent = page.items.length === 0 ? "No games yet." : "";
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      statusEl.textContent = `Failed to load games: ${message}`;
    }
  }

  void (async () => {
    try {
      platforms = await client.listPlatforms();
      renderPlatforms(platforms);
      const first = platforms[0];
      if (!first) {
        statusEl.textContent = "No platforms found.";
        return;
      }
      highlightPlatform(first.id);
      const firstPlatformEl = platformsEl.querySelector<HTMLElement>(".platform");
      if (firstPlatformEl) {
        firstPlatformEl.dataset.autofocus = "true";
        firstPlatformEl.focus();
      }
      await refreshGames(first);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      statusEl.textContent = `Failed to load platforms: ${message}`;
    }
  })();
}

async function loadCover(
  client: RomMClient,
  rom: SimpleRom,
  ts: string | null,
  img: HTMLImageElement,
): Promise<void> {
  if (!rom.path_cover_large) return;
  const cached = await getCachedCover(rom.id, ts);
  if (cached) {
    img.src = URL.createObjectURL(cached);
    return;
  }
  const relativePath = rom.path_cover_large;
  try {
    const response = await client.fetchCoverArt(relativePath);
    if (!response.ok) return;
    const blob = await response.blob();
    void storeCover(rom.id, ts, blob);
    img.src = URL.createObjectURL(blob);
  } catch {
    // No fallback: the placeholder colour block in CSS stands in.
  }
}
