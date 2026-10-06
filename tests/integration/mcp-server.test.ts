import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let server: Server;
let client: Client;
const seen: { method: string; url: string; body: string; auth: string | undefined }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ method: req.method ?? "", url: req.url ?? "", body, auth: req.headers.authorization });
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/trade/request") {
        res.end(JSON.stringify({ status: "rejected_by_risk", violations: [{ code: "TRADING_DISABLED" }] }));
        return;
      }
      res.end(JSON.stringify({ ok: true, url: req.url }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "mcp/trading-control/src/index.ts"],
      env: { ...process.env, API_URL: `http://127.0.0.1:${port}`, CONTROL_API_TOKEN: "tok-123" } as Record<string, string>,
    }),
  );
}, 60_000);

afterAll(async () => {
  await client?.close();
  server?.close();
});

describe("trading-control MCP server", () => {
  it("lists the operator tools and none that bypass risk", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["research_strategy", "run_validation", "request_trade", "disable_trading", "get_risk_status"]));
    expect(names).not.toContain("send_arbitrary_order");
  });

  it("request_trade is forwarded to the risk-checked API endpoint with the control token", async () => {
    const r = await client.callTool({ name: "request_trade", arguments: { strategyVersionId: "S-v1", direction: "UP", stake: "5", idempotencyKey: "ETH-15M-20261006T120000-S", reason: "test" } });
    expect(JSON.stringify(r.content)).toContain("TRADING_DISABLED");
    const last = seen.at(-1)!;
    expect(last.url).toBe("/api/trade/request");
    expect(last.auth).toBe("Bearer tok-123");
  });

  it("rejects invalid arguments before calling the API", async () => {
    const before = seen.length;
    const r = await client.callTool({ name: "request_trade", arguments: { strategyVersionId: "S-v1", direction: "SIDEWAYS", stake: "5", idempotencyKey: "k", reason: "x" } });
    expect(r.isError).toBe(true);
    expect(seen.length).toBe(before);
  });
});
