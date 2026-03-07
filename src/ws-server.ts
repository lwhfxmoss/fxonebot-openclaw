import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { ChannelLogSink } from "openclaw/plugin-sdk";
import { WebSocketServer, WebSocket } from "ws";
import type { ResolvedOneBotAccount } from "./types.js";

type OneBotApiResponse = {
  status?: string;
  retcode?: number;
  data?: Record<string, unknown>;
  echo?: string;
  [key: string]: unknown;
};

type PendingRequest = {
  resolve: (value: OneBotApiResponse) => void;
  reject: (reason?: unknown) => void;
  timer: NodeJS.Timeout;
};

type OneBotServerStatus = {
  connectedClients: number;
  inboundFrames: number;
  inboundEvents: number;
  lastInboundAt: number | null;
  selfIds: string[];
};

type OneBotServerState = {
  accountId: string;
  wss: WebSocketServer;
  clients: Set<WebSocket>;
  pending: Map<string, PendingRequest>;
  status: OneBotServerStatus;
  onStatus?: (status: OneBotServerStatus) => void;
  onMessageEvent?: (event: Record<string, unknown>) => Promise<void> | void;
  logger?: ChannelLogSink;
};

const serverStates = new Map<string, OneBotServerState>();

function toPath(raw?: string | null): string {
  const value = (raw ?? "").trim();
  if (!value) return "/";
  return value.startsWith("/") ? value : `/${value}`;
}

function parseBearer(authorization: string | undefined): string {
  if (!authorization) return "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function pickClient(state: OneBotServerState): WebSocket | null {
  for (const client of state.clients) {
    if (client.readyState === WebSocket.OPEN) {
      return client;
    }
  }
  return null;
}

function collectSelfIds(state: OneBotServerState): string[] {
  const values: string[] = [];
  for (const client of state.clients) {
    const selfId = String((client as { __onebotSelfId?: string }).__onebotSelfId ?? "").trim();
    if (selfId) {
      values.push(selfId);
    }
  }
  return Array.from(new Set(values));
}

function emitStatus(state: OneBotServerState) {
  state.status.connectedClients = state.clients.size;
  state.status.selfIds = collectSelfIds(state);
  state.onStatus?.({ ...state.status });
}

function rejectAllPending(state: OneBotServerState, reason: string) {
  for (const [, pending] of state.pending) {
    clearTimeout(pending.timer);
    pending.reject(new Error(reason));
  }
  state.pending.clear();
}

function validateConnection(params: {
  req: IncomingMessage;
  account: ResolvedOneBotAccount;
}): { ok: true } | { ok: false; reason: string } {
  const expectedPath = toPath(params.account.config.wsReverse.path);
  const requestPath = toPath((params.req.url ?? "/").split("?")[0]);
  if (requestPath !== expectedPath) {
    return { ok: false, reason: `invalid_path:${requestPath}` };
  }

  const expectedToken = String(params.account.config.wsReverse.token ?? "").trim();
  if (expectedToken) {
    const authHeader = String(params.req.headers.authorization ?? "");
    const providedToken = parseBearer(authHeader);
    if (providedToken !== expectedToken) {
      return { ok: false, reason: "invalid_token" };
    }
  }

  return { ok: true };
}

export async function startOneBotWsServer(params: {
  account: ResolvedOneBotAccount;
  logger?: ChannelLogSink;
  onStatus?: (status: OneBotServerStatus) => void;
  onMessageEvent?: (event: Record<string, unknown>) => Promise<void> | void;
}): Promise<void> {
  await stopOneBotWsServer(params.account.accountId);

  const wsConfig = params.account.config.wsReverse;
  const wss = new WebSocketServer({
    host: wsConfig.host,
    port: wsConfig.port,
    perMessageDeflate: false,
    maxPayload: 50 * 1024 * 1024,
  });

  const state: OneBotServerState = {
    accountId: params.account.accountId,
    wss,
    clients: new Set(),
    pending: new Map(),
    status: {
      connectedClients: 0,
      inboundFrames: 0,
      inboundEvents: 0,
      lastInboundAt: null,
      selfIds: [],
    },
    onStatus: params.onStatus,
    onMessageEvent: params.onMessageEvent,
    logger: params.logger,
  };

  serverStates.set(params.account.accountId, state);

  wss.on("connection", (ws, req) => {
    const validation = validateConnection({ req, account: params.account });
    if (!validation.ok) {
      try {
        ws.close(1008, validation.reason);
      } catch {
        ws.terminate();
      }
      return;
    }

    (ws as { __onebotSelfId?: string }).__onebotSelfId = String(
      req.headers["x-self-id"] ?? "",
    ).trim();

    state.clients.add(ws);
    emitStatus(state);

    ws.on("message", (raw) => {
      state.status.inboundFrames += 1;
      state.status.lastInboundAt = Date.now();
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(String(raw)) as Record<string, unknown>;
      } catch {
        return;
      }

      if (typeof frame.post_type === "string") {
        state.status.inboundEvents += 1;
        emitStatus(state);
        Promise.resolve(state.onMessageEvent?.(frame)).catch((err) => {
          state.logger?.error?.(`onebot inbound handler error: ${String(err)}`);
        });
        return;
      }

      const echo = typeof frame.echo === "string" ? frame.echo : undefined;
      if (!echo) {
        return;
      }

      const pending = state.pending.get(echo);
      if (!pending) {
        return;
      }

      clearTimeout(pending.timer);
      state.pending.delete(echo);
      pending.resolve(frame as OneBotApiResponse);
    });

    ws.on("close", () => {
      state.clients.delete(ws);
      emitStatus(state);
    });
  });

  await new Promise<void>((resolve, reject) => {
    wss.once("listening", () => resolve());
    wss.once("error", (err) => reject(err));
  });

  state.logger?.info?.(
    `onebot ws server listening on ${wsConfig.host}:${wsConfig.port}${toPath(wsConfig.path)}`,
  );
}

export async function stopOneBotWsServer(accountId: string): Promise<void> {
  const state = serverStates.get(accountId);
  if (!state) {
    return;
  }

  rejectAllPending(state, "onebot ws server stopped");

  for (const client of state.clients) {
    try {
      client.close();
    } catch {
      client.terminate();
    }
  }
  state.clients.clear();

  await new Promise<void>((resolve) => {
    state.wss.close(() => resolve());
  });

  serverStates.delete(accountId);
}

export async function sendOneBotAction(params: {
  accountId: string;
  action: string;
  payload: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<OneBotApiResponse> {
  const state = serverStates.get(params.accountId);
  if (!state) {
    throw new Error(`onebot server not started for account ${params.accountId}`);
  }

  const client = pickClient(state);
  if (!client) {
    throw new Error(`no onebot client connected for account ${params.accountId}`);
  }

  const timeoutMs = Math.max(500, params.timeoutMs ?? 8000);
  const echo = `onebot_${Date.now()}_${randomUUID().slice(0, 8)}`;

  const responsePromise = new Promise<OneBotApiResponse>((resolve, reject) => {
    const timer = setTimeout(() => {
      state.pending.delete(echo);
      reject(new Error(`onebot action timeout: ${params.action}`));
    }, timeoutMs);

    state.pending.set(echo, { resolve, reject, timer });
  });

  client.send(
    JSON.stringify({
      action: params.action,
      params: params.payload,
      echo,
    }),
  );

  return await responsePromise;
}

export function getOneBotServerStatus(accountId: string): OneBotServerStatus | null {
  const state = serverStates.get(accountId);
  if (!state) {
    return null;
  }
  return { ...state.status, selfIds: collectSelfIds(state) };
}
