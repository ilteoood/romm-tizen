import { ensureEmulatorJsLoaded, type EmulatorJSOptions } from "./loader";

export type BootOptions = EmulatorJSOptions & {
  core: string;
  romBlob: Blob;
  romName: string;
  dataPath: string;
  mount: HTMLElement;
};

export type EmulatorController = {
  pause(): Promise<void>;
  resume(): Promise<void>;
  getState(): Promise<Blob>;
  loadState(blob: Blob): Promise<void>;
  exit(): Promise<void>;
};

// shortcut: the loader exposes the running emulator on window.EJS_emulator after `new EmulatorJS(...)`.
//            The TS types only know about the constructor (window.EmulatorJS). Probe for methods at runtime.
async function waitForEmulator(): Promise<Record<string, unknown>> {
  const start = Date.now();
  while (Date.now() - start < 5000) {
    if (typeof window.EJS_emulator === "object" && window.EJS_emulator !== null) {
      return window.EJS_emulator as Record<string, unknown>;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("EmulatorJS did not start within 5s.");
}

async function callNoArg(emulator: Record<string, unknown>, method: string): Promise<void> {
  const fn = emulator[method];
  if (typeof fn !== "function") {
    throw new Error(`EmulatorJS ${method}() not available.`);
  }
  await (fn as () => unknown).call(emulator);
}

// Boots EmulatorJS with a downloaded ROM blob and returns a controller for pause / resume / getState / loadState / exit.
// shortcut: EmulatorJS option names ("name", "mount", "cacheConfig", "threading", "virtualGamepad") are taken
//            from the 4th-arg shape documented for current EmulatorJS. If the loader doesn't accept them,
//            the fallback is to set EJS_* globals on window and call `new EmulatorJS()` with no args.
// shortcut: the loader owns the blob URL and revokes it on teardown; we don't manually revoke.
// shortcut: the controller's surface is a best-effort wrapper — the actual EmulatorJS API shape is whatever
//            the loader exposes. Probe-and-throw is the contract.
export async function bootEmulator({
  core,
  romBlob,
  romName,
  dataPath,
  mount,
  cacheConfig,
  threading = false,
  virtualGamepad = true,
  name,
}: BootOptions): Promise<EmulatorController> {
  await ensureEmulatorJsLoaded(dataPath);
  const gameUrl = URL.createObjectURL(romBlob);
  const EmulatorJS = window.EmulatorJS;
  if (typeof EmulatorJS !== "function") {
    throw new Error("EmulatorJS loader did not expose a constructor on window.");
  }
  new EmulatorJS(core, gameUrl, dataPath, {
    ...(name !== undefined ? { name } : { name: romName }),
    mount,
    cacheConfig: cacheConfig ?? { cacheMaxSizeMB: 256, cacheMaxAgeMins: 4320 },
    threading,
    virtualGamepad,
  });
  const emulator = await waitForEmulator();
  return {
    async pause() {
      await callNoArg(emulator, "pause");
    },
    async resume() {
      await callNoArg(emulator, "resume");
    },
    async getState() {
      const fn = emulator["getState"];
      if (typeof fn === "function") {
        const result = await (fn as () => unknown).call(emulator);
        if (result instanceof Blob) return result;
        throw new Error("EmulatorJS getState() did not return a Blob.");
      }
      const alt = emulator["savestate"];
      if (typeof alt === "function") {
        const result = (alt as () => unknown).call(emulator);
        if (result instanceof Blob) return result;
        if (result && typeof (result as { blob?: () => Blob }).blob === "function") {
          return (result as { blob: () => Blob }).blob();
        }
      }
      throw new Error("EmulatorJS getState() not available.");
    },
    async loadState(blob) {
      const fn = emulator["loadState"];
      if (typeof fn !== "function") {
        throw new Error("EmulatorJS loadState() not available.");
      }
      await (fn as (b: Blob) => unknown).call(emulator, blob);
    },
    async exit() {
      await callNoArg(emulator, "exit");
    },
  };
}
