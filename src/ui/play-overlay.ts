import { activateFocusList } from "./focus";
import type { EmulatorController } from "../emulator/boot";
import type { RomMClient, SaveEntry, SimpleRom, StateEntry } from "../api/romm";

export type OverlayDeps = {
  root: HTMLElement;
  client: RomMClient;
  rom: SimpleRom;
  controller: EmulatorController;
  onResume: () => void;
  onExit: () => void;
};

type ActionKind = "resume" | "save" | "save-as" | "load" | "exit";
type PickerItem = { kind: "save" | "state"; id: string; label: string };

function formatTs(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(d);
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Unknown error";
}

function stateFileName(rom: SimpleRom): string {
  const utcIso = new Date().toISOString();
  return `${rom.fs_name_no_ext} [${utcIso}].state`;
}

export async function showPlayOverlay(deps: OverlayDeps): Promise<void> {
  const { root, client, rom, controller, onResume, onExit } = deps;

  const overlay = document.createElement("section");
  overlay.className = "play-overlay";
  overlay.dataset.state = "pausing";
  overlay.innerHTML = `
    <div class="backdrop"></div>
    <div class="panel">
      <h2>Paused</h2>
      <ul class="actions" data-actions></ul>
      <ul class="picker" data-picker hidden></ul>
      <p class="status" data-status></p>
    </div>
  `;
  root.appendChild(overlay);

  const actionsEl = overlay.querySelector<HTMLElement>("[data-actions]")!;
  const pickerEl = overlay.querySelector<HTMLElement>("[data-picker]")!;
  const statusEl = overlay.querySelector<HTMLElement>("[data-status]")!;

  let resolveDone!: () => void;
  const donePromise = new Promise<void>((res) => {
    resolveDone = res;
  });
  let cleanupFocus: (() => void) | null = null;

  const setStatus = (text: string): void => {
    statusEl.textContent = text;
  };
  const setState = (state: string): void => {
    overlay.dataset.state = state;
  };

  const finish = (): void => {
    cleanupFocus?.();
    cleanupFocus = null;
    overlay.remove();
    resolveDone();
  };

  const buildActions = (): void => {
    actionsEl.innerHTML = "";
    const items: Array<{ action: ActionKind; label: string; autofocus?: boolean; danger?: boolean }> = [
      { action: "resume", label: "Resume", autofocus: true },
      { action: "save", label: "Save (overwrite autosave)" },
      { action: "save-as", label: "Save as… (new snapshot)" },
      { action: "load", label: "Load…" },
      { action: "exit", label: "Exit", danger: true },
    ];
    for (const item of items) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.dataset.action = item.action;
      btn.tabIndex = 0;
      btn.textContent = item.label;
      if (item.autofocus) btn.dataset.autofocus = "true";
      if (item.danger) btn.dataset.danger = "true";
      li.appendChild(btn);
      actionsEl.appendChild(li);
    }
  };

  const showActions = (): void => {
    pickerEl.hidden = true;
    pickerEl.innerHTML = "";
    actionsEl.hidden = false;
    buildActions();
    setState("running");
    activateActionsFocus();
  };

  const showPicker = (items: PickerItem[]): void => {
    actionsEl.hidden = true;
    pickerEl.innerHTML = "";
    const buttons: HTMLElement[] = [];
    for (const item of items) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.dataset.kind = item.kind;
      btn.dataset.id = item.id;
      btn.tabIndex = 0;
      btn.textContent = item.label;
      if (item.kind === "save") btn.dataset.autosave = "true";
      li.appendChild(btn);
      pickerEl.appendChild(li);
      buttons.push(btn);
    }
    if (buttons[0]) buttons[0].dataset.autofocus = "true";
    pickerEl.hidden = false;
    setState("running");
    activatePickerFocus(buttons);
  };

  const activateActionsFocus = (): void => {
    cleanupFocus?.();
    cleanupFocus = activateFocusList({
      items: (): HTMLElement[] => Array.from(actionsEl.querySelectorAll<HTMLElement>("button")),
      onSelect: (item) => {
        const action = item.dataset.action as ActionKind | undefined;
        if (action === "resume") void doResume();
        else if (action === "save" || action === "save-as") void doSave();
        else if (action === "load") void doOpenPicker();
        else if (action === "exit") void doExit();
      },
      onBack: () => void doResume(),
    });
  };

  const activatePickerFocus = (buttons: HTMLElement[]): void => {
    cleanupFocus?.();
    cleanupFocus = activateFocusList({
      items: (): HTMLElement[] => buttons.filter((b) => !b.hidden),
      onSelect: (item) => {
        const kind = item.dataset.kind;
        const id = item.dataset.id ?? "";
        void doLoad(kind, id);
      },
      onBack: () => showActions(),
    });
  };

  const doResume = async (): Promise<void> => {
    setState("resuming");
    setStatus("Resuming…");
    try {
      await controller.resume();
    } catch (err) {
      setStatus(`Resume failed: ${errorMessage(err)}`);
      setState("error");
      return;
    }
    finish();
    onResume();
  };

  // shortcut: Save / Save as… both produce a new auto-timestamped state — see PR body
  const doSave = async (): Promise<void> => {
    setState("saving");
    setStatus("Saving…");
    try {
      const blob = await controller.getState();
      await client.uploadState(rom.id, blob, stateFileName(rom));
      setStatus("Saved.");
      await controller.resume();
    } catch (err) {
      setStatus(`Save failed: ${errorMessage(err)}`);
      setState("error");
      return;
    }
    finish();
    onResume();
  };

  const doOpenPicker = async (): Promise<void> => {
    setState("loading");
    setStatus("Loading…");
    let saves: SaveEntry[] = [];
    let states: StateEntry[] = [];
    try {
      const [savesResult, statesResult] = await Promise.allSettled([
        client.listSaves(rom.id),
        client.listStates(rom.id),
      ]);
      saves = savesResult.status === "fulfilled" ? savesResult.value : [];
      states = statesResult.status === "fulfilled" ? statesResult.value : [];
      const errors: string[] = [];
      if (savesResult.status === "rejected") errors.push(`saves: ${errorMessage(savesResult.reason)}`);
      if (statesResult.status === "rejected") errors.push(`states: ${errorMessage(statesResult.reason)}`);

      const items: PickerItem[] = [];
      const autosave = saves.find((s) => s.slot === "autosave");
      if (autosave) {
        items.push({
          kind: "save",
          id: "autosave",
          label: `Autosave — ${formatTs(autosave.updated_at)}`,
        });
      }
      const sortedStates = [...states].sort(
        (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
      );
      for (const s of sortedStates) {
        items.push({
          kind: "state",
          id: String(s.id),
          label: `${s.file_name_no_tags ?? s.file_name ?? "Snapshot"} — ${formatTs(s.created_at)}`,
        });
      }

      if (items.length === 0) {
        setStatus(errors.length > 0 ? `No saves available (${errors.join(", ")})` : "No saves available.");
        setState("error");
        return;
      }

      setStatus("");
      showPicker(items);
    } catch (err) {
      setStatus(`Load failed: ${errorMessage(err)}`);
      setState("error");
    }
  };

  const doLoad = async (kind: string | undefined, id: string): Promise<void> => {
    setState("loading");
    setStatus("Loading…");
    try {
      let blob: Blob;
      if (kind === "save") {
        blob = await client.downloadSave(rom.id, id);
      } else if (kind === "state") {
        blob = await client.downloadState(Number(id));
      } else {
        throw new Error("Unknown snapshot kind.");
      }
      await controller.loadState(blob);
      setStatus("Loaded.");
      await controller.resume();
    } catch (err) {
      setStatus(`Load failed: ${errorMessage(err)}`);
      setState("error");
      return;
    }
    finish();
    onResume();
  };

  const doExit = async (): Promise<void> => {
    setState("saving");
    setStatus("Saving…");
    try {
      const blob = await controller.getState();
      await client.uploadState(rom.id, blob, stateFileName(rom));
      setStatus("Saved.");
    } catch (err) {
      // shortcut: best-effort save on exit — failures are logged but not blocking
      setStatus(`Save failed: ${errorMessage(err)}`);
    }
    finish();
    onExit();
  };

  setStatus("Pausing…");
  try {
    await controller.pause();
  } catch (err) {
    setStatus(`Pause failed: ${errorMessage(err)}`);
    setState("error");
  }

  showActions();

  return donePromise;
}
