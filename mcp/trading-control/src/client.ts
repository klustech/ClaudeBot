export interface ApiClientOptions {
  baseUrl: string;
  token?: string;
  model?: string;
  sessionId?: string;
  fetchImpl?: typeof fetch;
}

export class TradingApiClient {
  constructor(private readonly o: ApiClientOptions) {}

  async request(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    const res = await (this.o.fetchImpl ?? fetch)(`${this.o.baseUrl}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(this.o.token ? { authorization: `Bearer ${this.o.token}` } : {}),
        "x-claude-model": this.o.model ?? "claude-code",
        "x-claude-session": this.o.sessionId ?? `mcp-${process.pid}`,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* keep text */
    }
    if (!res.ok) {
      const msg = typeof data === "object" && data && "error" in data ? JSON.stringify((data as { error: unknown }).error) : String(text);
      throw new Error(`API ${method} ${path} → ${res.status}: ${msg}`);
    }
    return data;
  }
}
