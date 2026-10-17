import { loadCredentials } from "../storage/store";
import { RomMClient, type SimpleRom } from "../api/romm";
import { romsStorage } from "../storage/roms";
import { bootEmulator, type EmulatorController } from "../emulator/boot";
import { resolveDataPath } from "../emulator/data-path";
import { showPlayOverlay } from "./play-overlay";

const PLATFORM_CORE: Record<string, string> = {
  nes: "fceumm",
  snes: "snes9x", // shortcut: non-commercial core; license swap is a follow-up
  genesis: "genesis_plus_gx", // shortcut: non-commercial core; license swap is a follow-up
  gba: "mgba",
};

function isBackKey(key: string): boolean {
  return key === "Backspace" || key === "Escape" || key === "GoBack";
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Unknown error";
}

export function renderPlay(root: HTMLElement, romId: number, onExit: () => void): void {
  const credentials = loadCredentials();
  if (!credentials) {
    onExit();
    return;
  }
  const client = new RomMClient(credentials);

  root.replaceChildren();
  const screen = document.createElement("section");
  screen.className = "screen play";
  screen.innerHTML = `
    <div id="game"></div>
    <button class="exit-btn" data-action="exit" aria-label="Exit" tabindex="0">&larr; Exit</button>
  `;
  root.appendChild(screen);

  const mount = screen.querySelector<HTMLDivElement>("#game")!;
  const exitBtn = screen.querySelector<HTMLButtonElement>("[data-action='exit']")!;

  let currentRom: SimpleRom | null = null;
  let controller: EmulatorController | null = null;
  let overlayOpen = false;
  let backPressCount = 0;
  let backPressTimer: number | null = null;

  function showError(message: string): void {
    screen.replaceChildren();
    const errorEl = document.createElement("p");
    errorEl.className = "play-error";
    errorEl.textContent = message;
    screen.appendChild(errorEl);
    screen.appendChild(exitBtn);
  }

  function teardown(): void {
    document.removeEventListener("keydown", handleBack);
    onExit();
  }

  function handleBack(event: KeyboardEvent): void {
    if (!isBackKey(event.key)) return;
    if (overlayOpen) return;
    event.preventDefault();
    if (backPressTimer !== null) clearTimeout(backPressTimer);
    backPressTimer = window.setTimeout(() => {
      backPressCount = 0;
      backPressTimer = null;
    }, 500);
    if (backPressCount === 0) {
      backPressCount = 1;
      void openOverlay();
    }
    // shortcut: a second Back within 500ms is a no-op here — the overlay's focus list handles Back (Resume).
  }

  async function openOverlay(): Promise<void> {
    if (overlayOpen) return;
    if (!controller || !currentRom) return;
    overlayOpen = true;
    try {
      await showPlayOverlay({
        root,
        client,
        rom: currentRom,
        controller,
        onResume: () => {
          overlayOpen = false;
          backPressCount = 0;
          if (backPressTimer !== null) {
            clearTimeout(backPressTimer);
            backPressTimer = null;
          }
        },
        onExit: () => {
          controller
            ?.exit()
            .catch(() => {
              // shortcut: best-effort teardown — the screen pop is unconditional
            });
          teardown();
        },
      });
    } finally {
      overlayOpen = false;
    }
  }

  exitBtn.addEventListener("click", () => {
    if (overlayOpen) return;
    if (!controller) {
      teardown();
      return;
    }
    void openOverlay();
  });
  document.addEventListener("keydown", handleBack);

  void (async () => {
    let rom: SimpleRom;
    try {
      rom = await client.getRom(romId);
    } catch (err) {
      showError(`Failed to load game: ${errorMessage(err)}`);
      return;
    }
    currentRom = rom;
    const core = PLATFORM_CORE[rom.platform_slug];
    if (!core) {
      showError(`Unsupported platform: ${rom.platform_slug}`);
      return;
    }
    let romBlob: Blob | null;
    try {
      romBlob = await romsStorage.get(romId);
    } catch (err) {
      showError(`Failed to read ROM cache: ${errorMessage(err)}`);
      return;
    }
    if (!romBlob) {
      showError("ROM not found in cache");
      return;
    }
    let dataPath: string;
    try {
      dataPath = await resolveDataPath();
    } catch (err) {
      showError(`Failed to load EmulatorJS: ${errorMessage(err)}`);
      return;
    }
    const romName = `${rom.fs_name_no_ext}.${rom.fs_extension}`;
    try {
      controller = await bootEmulator({ core, romBlob, romName, dataPath, mount });
    } catch (err) {
      showError(`Failed to load EmulatorJS: ${errorMessage(err)}`);
    }
  })();
}
