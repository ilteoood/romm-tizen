import { loadCredentials } from "../storage/store";
import { RomMClient } from "../api/romm";
import { romsStorage } from "../storage/roms";
import { bootEmulator } from "../emulator/boot";
import { resolveDataPath } from "../emulator/data-path";

const PLATFORM_CORE: Record<string, string> = {
  nes: "fceumm",
  snes: "snes9x", // shortcut: non-commercial core; license swap is a follow-up
  genesis: "genesis_plus_gx", // shortcut: non-commercial core; license swap is a follow-up
  gba: "mgba",
};

// shortcut: direct teardown on Back; the D8 in-game overlay (Resume / Save / Save as... / Load... / Exit) replaces this.
function isBackKey(key: string): boolean {
  return key === "Backspace" || key === "Escape" || key === "GoBack";
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
    if (isBackKey(event.key)) {
      event.preventDefault();
      teardown();
    }
  }

  exitBtn.addEventListener("click", () => teardown());
  document.addEventListener("keydown", handleBack);

  void (async () => {
    let rom;
    try {
      rom = await client.getRom(romId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      showError(`Failed to load game: ${message}`);
      return;
    }
    const core = PLATFORM_CORE[rom.platform_slug];
    if (!core) {
      showError(`Unsupported platform: ${rom.platform_slug}`);
      return;
    }
    let romBlob;
    try {
      romBlob = await romsStorage.get(romId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      showError(`Failed to read ROM cache: ${message}`);
      return;
    }
    if (!romBlob) {
      showError("ROM not found in cache");
      return;
    }
    let dataPath;
    try {
      dataPath = await resolveDataPath();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      showError(`Failed to load EmulatorJS: ${message}`);
      return;
    }
    const romName = `${rom.fs_name_no_ext}.${rom.fs_extension}`;
    try {
      await bootEmulator({ core, romBlob, romName, dataPath, mount });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      showError(`Failed to load EmulatorJS: ${message}`);
    }
  })();
}
