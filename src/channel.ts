import {
  applyAccountNameToChannelSection,
  buildChannelConfigSchema,
  DEFAULT_ACCOUNT_ID,
  formatPairingApproveHint,
  resolveAllowlistProviderRuntimeGroupPolicy,
  resolveDefaultGroupPolicy,
  setAccountEnabledInConfigSection,
  type ChannelPlugin,
  type OpenClawConfig,
} from "openclaw/plugin-sdk/compat";
import {
  listOneBotAccountIds,
  resolveDefaultOneBotAccountId,
  resolveOneBotAccount,
} from "./accounts.js";
import { OneBotConfigSchema } from "./config-schema.js";
import { handleOneBotInbound } from "./inbound.js";
import type { ResolvedOneBotAccount } from "./types.js";
import {
  getOneBotServerStatus,
  sendOneBotAction,
  startOneBotWsServer,
  stopOneBotWsServer,
} from "./ws-server.js";

const CHANNEL_ID = "onebot";

function normalizeAllowEntry(raw: string): string {
  return raw.trim().replace(/^qq:/i, "");
}

function parseTarget(to: string): { kind: "group" | "direct"; id: string } {
  const value = to.trim();
  if (!value) {
    throw new Error("empty onebot target");
  }
  if (/^qqg:/i.test(value)) {
    return { kind: "group", id: value.replace(/^qqg:/i, "").trim() };
  }
  if (/^group:/i.test(value)) {
    return { kind: "group", id: value.replace(/^group:/i, "").trim() };
  }
  if (/^qq:/i.test(value)) {
    return { kind: "direct", id: value.replace(/^qq:/i, "").trim() };
  }
  return { kind: "direct", id: value };
}

function toOneBotId(raw: string): string | number {
  const value = raw.trim();
  if (/^\d+$/.test(value)) {
    return Number(value);
  }
  return value;
}

function resolveMessageId(response: Record<string, unknown> | undefined): string {
  const data = (response?.data as Record<string, unknown> | undefined) ?? {};
  const messageId = data.message_id ?? response?.message_id;
  if (messageId === undefined || messageId === null) {
    return `${Date.now()}`;
  }
  return String(messageId);
}

export const onebotPlugin: ChannelPlugin<ResolvedOneBotAccount> = {
  id: CHANNEL_ID,
  meta: {
    id: CHANNEL_ID,
    label: "OneBot",
    selectionLabel: "OneBot (NapCat WS)",
    detailLabel: "OneBot v11",
    docsPath: "/channels/onebot",
    docsLabel: "onebot",
    blurb: "OneBot v11 channel skeleton for NapCat WS reverse mode",
  },
  pairing: {
    idLabel: "qqUserId",
    normalizeAllowEntry: normalizeAllowEntry,
  },
  capabilities: {
    chatTypes: ["direct", "group"],
    media: true,
  },
  reload: { configPrefixes: ["channels.onebot"] },
  configSchema: buildChannelConfigSchema(OneBotConfigSchema),
  config: {
    listAccountIds: (cfg) => listOneBotAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveOneBotAccount({ cfg, accountId }),
    defaultAccountId: (cfg) => resolveDefaultOneBotAccountId(cfg),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg,
        sectionKey: "onebot",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    isConfigured: (account) => account.configured,
    describeAccount: (account) => {
      const status = getOneBotServerStatus(account.accountId);
      return {
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured: account.configured,
        dmPolicy: account.config.dmPolicy,
        allowFrom: account.config.allowFrom,
        ownerAllowFrom: account.config.ownerAllowFrom,
        connected: (status?.connectedClients ?? 0) > 0,
        lastInboundAt: status?.lastInboundAt ?? null,
      };
    },
    resolveAllowFrom: ({ cfg, accountId }) =>
      resolveOneBotAccount({ cfg, accountId }).config.allowFrom ?? [],
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom.map((entry) => normalizeAllowEntry(String(entry))).filter(Boolean),
    resolveDefaultTo: ({ cfg, accountId }) =>
      resolveOneBotAccount({ cfg, accountId }).config.defaultTo?.trim() || undefined,
  },
  security: {
    resolveDmPolicy: ({ cfg, accountId, account }) => {
      const resolvedAccountId = accountId ?? account.accountId ?? DEFAULT_ACCOUNT_ID;
      const channels = ((cfg as { channels?: unknown }).channels ?? {}) as Record<string, unknown>;
      const onebotChannel =
        (channels.onebot as { accounts?: Record<string, unknown> } | undefined) ?? undefined;
      const useAccountPath = Boolean(onebotChannel?.accounts?.[resolvedAccountId]);
      const basePath = useAccountPath
        ? `channels.onebot.accounts.${resolvedAccountId}.`
        : "channels.onebot.";
      return {
        policy: account.config.dmPolicy ?? "pairing",
        allowFrom: account.config.allowFrom ?? [],
        policyPath: `${basePath}dmPolicy`,
        allowFromPath: basePath,
        approveHint: formatPairingApproveHint("onebot"),
        normalizeEntry: normalizeAllowEntry,
      };
    },
    collectWarnings: ({ account, cfg }) => {
      const defaultGroupPolicy = resolveDefaultGroupPolicy(cfg);
      const channels = ((cfg as { channels?: unknown }).channels ?? {}) as Record<string, unknown>;
      const { groupPolicy } = resolveAllowlistProviderRuntimeGroupPolicy({
        providerConfigPresent: channels.onebot !== undefined,
        groupPolicy: account.config.groupPolicy,
        defaultGroupPolicy,
      });
      if (groupPolicy !== "open") {
        return [];
      }
      return [
        '- OneBot groups: groupPolicy="open" allows all senders (mention-gated). Prefer allowlist mode for production.',
      ];
    },
  },
  groups: {
    resolveRequireMention: ({ cfg, accountId, groupId }) => {
      const account = resolveOneBotAccount({
        cfg: cfg as OpenClawConfig,
        accountId,
      });
      if (!groupId) {
        return true;
      }
      const groupRule = account.config.groups[groupId] ?? account.config.groups["*"];
      if (typeof groupRule?.requireMention === "boolean") {
        return groupRule.requireMention;
      }
      return true;
    },
  },
  outbound: {
    deliveryMode: "gateway",
    textChunkLimit: 4000,
    sendText: async ({ cfg, to, text, accountId }) => {
      const account = resolveOneBotAccount({ cfg, accountId });
      const target = parseTarget(to);

      const response =
        target.kind === "group"
          ? await sendOneBotAction({
              accountId: account.accountId,
              action: "send_group_msg",
              payload: {
                group_id: toOneBotId(target.id),
                message: text,
              },
            })
          : await sendOneBotAction({
              accountId: account.accountId,
              action: "send_private_msg",
              payload: {
                user_id: toOneBotId(target.id),
                message: text,
              },
            });

      return {
        channel: CHANNEL_ID,
        chatId: to,
        messageId: resolveMessageId(response as Record<string, unknown>),
      };
    },
    sendMedia: async ({ cfg, to, text, mediaUrl, accountId }) => {
      const merged = mediaUrl
        ? text
          ? `${text}\n[CQ:image,file=${mediaUrl}]`
          : `[CQ:image,file=${mediaUrl}]`
        : text;

      if (!merged) {
        throw new Error("onebot media send requires text or mediaUrl");
      }

      return await onebotPlugin.outbound!.sendText!({
        cfg,
        to,
        text: merged,
        accountId,
      });
    },
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = resolveOneBotAccount({
        cfg: ctx.cfg,
        accountId: ctx.accountId,
      });

      if (!account.enabled) {
        ctx.log?.info?.(`onebot account ${ctx.accountId} disabled; skipping start`);
        return;
      }
      if (!account.configured) {
        ctx.log?.warn?.(`onebot account ${ctx.accountId} is not configured`);
        return;
      }

      await startOneBotWsServer({
        account,
        logger: ctx.log,
        onStatus: (status) => {
          const current = ctx.getStatus();
          ctx.setStatus({
            ...current,
            accountId: ctx.accountId,
            connected: status.connectedClients > 0,
            lastInboundAt: status.lastInboundAt,
          });
        },
        onMessageEvent: async (event) => {
          await handleOneBotInbound({
            event,
            account,
            config: ctx.cfg as OpenClawConfig,
            runtime: ctx.runtime,
            statusSink: (patch) => {
              const current = ctx.getStatus();
              ctx.setStatus({
                ...current,
                accountId: ctx.accountId,
                ...patch,
              });
            },
          });
        },
      });

      ctx.setStatus({
        accountId: ctx.accountId,
        running: true,
        configured: account.configured,
        enabled: account.enabled,
        connected: false,
        lastStartAt: Date.now(),
        lastError: null,
      });

      await new Promise<void>((resolve) => {
        if (ctx.abortSignal.aborted) {
          resolve();
          return;
        }
        ctx.abortSignal.addEventListener("abort", () => resolve(), { once: true });
      });

      await stopOneBotWsServer(account.accountId);
      ctx.setStatus({
        ...ctx.getStatus(),
        accountId: ctx.accountId,
        running: false,
        connected: false,
        lastStopAt: Date.now(),
      });
    },
    stopAccount: async (ctx) => {
      await stopOneBotWsServer(ctx.accountId);
      ctx.setStatus({
        ...ctx.getStatus(),
        accountId: ctx.accountId,
        running: false,
        connected: false,
        lastStopAt: Date.now(),
      });
    },
  },
  setup: {
    resolveAccountId: ({ accountId }) => accountId?.trim() || DEFAULT_ACCOUNT_ID,
    applyAccountName: ({ cfg, accountId, name }) =>
      applyAccountNameToChannelSection({
        cfg,
        channelKey: CHANNEL_ID,
        accountId,
        name,
      }),
    applyAccountConfig: ({ cfg }) => cfg,
  },
};
