const BASE_URL_KEY = "romm.baseUrl";
const TOKEN_KEY = "romm.token";
const TOKEN_PATTERN = /^rmm_[0-9a-f]{64}$/i;

export type Credentials = {
  baseUrl: string;
  token: string;
};

export function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

export function isValidToken(raw: string): boolean {
  return TOKEN_PATTERN.test(raw.trim());
}

export function loadCredentials(): Credentials | null {
  const baseUrl = localStorage.getItem(BASE_URL_KEY);
  const token = localStorage.getItem(TOKEN_KEY);
  if (!baseUrl || !token) return null;
  return { baseUrl, token };
}

export function saveCredentials(credentials: Credentials): void {
  localStorage.setItem(BASE_URL_KEY, credentials.baseUrl);
  localStorage.setItem(TOKEN_KEY, credentials.token);
}

export function clearCredentials(): void {
  localStorage.removeItem(BASE_URL_KEY);
  localStorage.removeItem(TOKEN_KEY);
}
