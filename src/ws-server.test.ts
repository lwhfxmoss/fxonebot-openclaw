import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { ResolvedOneBotAccount } from "./types.js";
import { sendOneBotAction, startOneBotWsServer, stopOneBotWsServer } from "./ws-server.js";

async function findFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("failed to resolve free port"));
        return;
      }
      const port = addr.port;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

function buildAccount(params: {
  accountId: string;
  port: number;
  token: string;
}): ResolvedOneBotAccount {
  return {
    accountId: params.accountId,
    enabled: true,
    configured: true,
    config: {
      dmPolicy: "pairing",
      allowFrom: [],
      ownerAllowFrom: [],
      groupPolicy: "allowlist",
      groupAllowFrom: [],
      groups: {},
      wsReverse: {
        host: "127.0.0.1",
        port: params.port,
        path: "/onebot/v11/ws",
        token: params.token,
      },
    },
  };
}

afterEach(async () => {
  await stopOneBotWsServer("test");
  await stopOneBotWsServer("test-invalid");
});

describe("onebot ws-server", () => {
  it("supports action roundtrip via echo", async () => {
    const port = await findFreePort();
    const account = buildAccount({ accountId: "test", port, token: "token-123" });

    await startOneBotWsServer({ account });

    const client = new WebSocket(`ws://127.0.0.1:${port}/onebot/v11/ws`, {
      headers: {
        Authorization: "Bearer token-123",
        "X-Self-ID": "10001",
        "X-Client-Role": "Universal",
      },
    });

    await new Promise<void>((resolve, reject) => {
      client.once("open", () => resolve());
      client.once("error", (err) => reject(err));
    });

    client.on("message", (raw) => {
      const frame = JSON.parse(String(raw)) as { action?: string; echo?: string };
      if (!frame.echo) return;
      client.send(
        JSON.stringify({
          status: "ok",
          retcode: 0,
          data: { from: "test" },
          echo: frame.echo,
        }),
      );
    });

    const response = await sendOneBotAction({
      accountId: "test",
      action: "get_status",
      payload: {},
      timeoutMs: 3000,
    });

    expect(response.status).toBe("ok");
    expect(response.retcode).toBe(0);
    expect((response.data as { from?: string })?.from).toBe("test");

    client.close();
  });

  it("rejects invalid token connection", async () => {
    const port = await findFreePort();
    const account = buildAccount({ accountId: "test-invalid", port, token: "real-token" });

    await startOneBotWsServer({ account });

    const client = new WebSocket(`ws://127.0.0.1:${port}/onebot/v11/ws`, {
      headers: {
        Authorization: "Bearer wrong-token",
        "X-Self-ID": "10002",
        "X-Client-Role": "Universal",
      },
    });

    const closeCode = await new Promise<number>((resolve) => {
      client.once("close", (code) => resolve(code));
      client.once("error", () => resolve(-1));
    });

    expect(closeCode).toBe(1008);
  });
});
