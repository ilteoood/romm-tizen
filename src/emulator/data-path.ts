import { loadCredentials } from "../storage/store";

const DEFAULT_EJS_TAG = "0.4.0"; // Bump per .wgt release; pinned CDN folder for EmulatorJS data/.

export async function resolveDataPath(): Promise<string> {
  const credentials = loadCredentials();
  if (!credentials) throw new Error("Not signed in.");
  const rommBase = credentials.baseUrl.replace(/\/$/, "");
  const rommDataPath = `${rommBase}/data`;
  const tag = import.meta.env.VITE_EJS_DATA_TAG ?? DEFAULT_EJS_TAG;
  const cdnDataPath = `https://cdn.emulatorjs.org/${tag}/data`;
  if (await canFetch(rommDataPath)) return rommDataPath;
  // shortcut: silent fallback to a pinned public CDN. Custom-path RomM users that don't mount EmulatorJS data/ fall through here.
  return cdnDataPath;
}

async function canFetch(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
}
