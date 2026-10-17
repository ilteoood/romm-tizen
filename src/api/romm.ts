import type { Credentials } from "../storage/store";

export type Platform = {
  id: number;
  name: string;
  custom_name: string | null;
  display_name: string;
  rom_count: number;
  updated_at: string;
};

export type SimpleRom = {
  id: number;
  name: string;
  fs_name: string;
  fs_name_no_ext: string;
  fs_extension: string;
  fs_size_bytes: number;
  platform_id: number;
  platform_slug: string;
  platform_display_name: string;
  summary: string;
  path_cover_small: string | null;
  path_cover_large: string | null;
  is_identified: boolean;
};

export type RomPage = {
  items: SimpleRom[];
  total: number | null;
  limit: number;
  offset: number;
};

export type RomsListOptions = {
  platformIds?: number[];
  searchTerm?: string;
  orderBy?: string;
  orderDir?: "asc" | "desc";
  limit?: number;
  offset?: number;
};

export class RomMClient {
  readonly credentials: Credentials;

  constructor(credentials: Credentials) {
    this.credentials = credentials;
  }

  private get baseUrl(): string {
    return this.credentials.baseUrl;
  }

  private get authHeader(): string {
    return `Bearer ${this.credentials.token}`;
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", this.authHeader);
    if (!headers.has("Accept")) headers.set("Accept", "application/json");
    return fetch(`${this.baseUrl}${path}`, { ...init, headers });
  }

  private async getJson<T>(path: string): Promise<T> {
    const response = await this.request(path);
    if (!response.ok) {
      throw new Error(`GET ${path} → ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as T;
  }

  async heartbeat(): Promise<void> {
    const response = await this.request("/api/heartbeat");
    if (!response.ok) {
      throw new Error(`Heartbeat failed: ${response.status} ${response.statusText}`);
    }
  }

  async listPlatforms(): Promise<Platform[]> {
    return this.getJson<Platform[]>("/api/platforms");
  }

  async listRoms(options: RomsListOptions = {}): Promise<RomPage> {
    const params = new URLSearchParams();
    if (options.platformIds) {
      for (const id of options.platformIds) params.append("platform_ids", String(id));
    }
    if (options.searchTerm) params.set("search_term", options.searchTerm);
    if (options.orderBy !== undefined) params.set("order_by", options.orderBy);
    if (options.orderDir) params.set("order_dir", options.orderDir);
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    if (options.offset !== undefined) params.set("offset", String(options.offset));
    params.set("with_rom_id_index", "false");
    params.set("with_total", "true");
    params.set("with_char_index", "false");
    params.set("with_filter_values", "false");
    params.set("with_files", "false");
    return this.getJson<RomPage>(`/api/roms?${params.toString()}`);
  }

  async getRom(id: number): Promise<SimpleRom> {
    return this.getJson<SimpleRom>(`/api/roms/${id}/simple`);
  }

  async downloadRom(id: number, fileName: string = "rom", signal?: AbortSignal): Promise<Response> {
    return this.request(`/api/roms/${id}/content/${fileName}`, { signal });
  }

  coverArtUrl(relativePath: string | null | undefined): string | null {
    if (!relativePath) return null;
    return `${this.baseUrl}${relativePath}`;
  }

  romContentUrl(id: number, fileName: string = "rom"): string {
    return `${this.baseUrl}/api/roms/${id}/content/${fileName}`;
  }

  async fetchCoverArt(relativePath: string): Promise<Response> {
    return this.request(relativePath);
  }
}
