// Injects the EmulatorJS loader script and resolves when `window.EmulatorJS` is ready.
// shortcut: the dataPath is the versioned EmulatorJS data directory (e.g. .../data), not a specific file.
//            Upgrade only if EmulatorJS ships an ESM entrypoint we should prefer.
export type EmulatorJSOptions = {
  name?: string;
  mount?: HTMLElement;
  cacheConfig?: { cacheMaxSizeMB?: number; cacheMaxAgeMins?: number };
  threading?: boolean;
  virtualGamepad?: boolean;
};

export type EmulatorJSConstructor = new (
  core: string,
  gameUrl: string,
  dataPath: string,
  options?: EmulatorJSOptions,
) => void;

declare global {
  interface Window {
    EmulatorJS?: EmulatorJSConstructor;
  }
}

export async function ensureEmulatorJsLoaded(dataPath: string): Promise<void> {
  if (window.EmulatorJS) return;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${dataPath.replace(/\/$/, "")}/loader.js`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load EmulatorJS from ${script.src}`));
    document.head.appendChild(script);
  });
}
