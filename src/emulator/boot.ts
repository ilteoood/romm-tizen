import { ensureEmulatorJsLoaded, type EmulatorJSOptions } from "./loader";

export type BootOptions = EmulatorJSOptions & {
  core: string;
  romBlob: Blob;
  romName: string;
  dataPath: string;
  mount: HTMLElement;
};

// Boots EmulatorJS with a downloaded ROM blob.
// shortcut: EmulatorJS option names ("name", "mount", "cacheConfig", "threading", "virtualGamepad") are taken
//            from the 4th-arg shape documented for current EmulatorJS. If the loader doesn't accept them,
//            the fallback is to set EJS_* globals on window and call `new EmulatorJS()` with no args.
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
}: BootOptions): Promise<void> {
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
  // shortcut: the loader owns the blob URL and revokes it on teardown; we don't manually revoke.
}
