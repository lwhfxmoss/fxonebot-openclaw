import {
  GROUP_POLICY_BLOCKED_LABEL,
  createNormalizedOutboundDeliverer,
  createReplyPrefixOptions,
  createScopedPairingAccess,
  createTypingCallbacks,
  formatTextWithAttachmentLinks,
  logTypingFailure,
  readStoreAllowFromForDmPolicy,
  resolveDmGroupAccessWithCommandGate,
  resolveMentionGatingWithBypass,
  resolveOutboundMediaUrls,
  resolveAllowlistProviderRuntimeGroupPolicy,
  resolveDefaultGroupPolicy,
  warnMissingProviderGroupPolicyFallbackOnce,
  type OpenClawConfig,
  type OutboundReplyPayload,
  type RuntimeEnv,
} from "openclaw/plugin-sdk";
import { getOneBotRuntime } from "./runtime.js";
import type { OneBotGroupRule, ResolvedOneBotAccount } from "./types.js";
import { sendOneBotAction } from "./ws-server.js";

const CHANNEL_ID = "onebot" as const;
const MESSAGE_DEDUPE_TTL_MS = 120_000;
const ONEBOT_TYPING_KEEPALIVE_INTERVAL_MS = 3_000;
const ONEBOT_TYPING_MAX_DURATION_MS = 60_000;
const seenMessageIds = new Map<string, number>();

type OneBotMessageSegment = {
  type?: string;
  data?: Record<string, unknown>;
};

export type OneBotInboundEvent = {
  post_type?: string;
  message_type?: string;
  self_id?: string | number;
  user_id?: string | number;
  group_id?: string | number;
  message?: string | OneBotMessageSegment[];
  raw_message?: string;
  time?: number;
  message_id?: string | number;
  sender?: {
    nickname?: string;
    card?: string;
  };
};

type GroupBindingCommand =
  | {
      action: "grant" | "revoke";
      targetUserId: string;
      groupId: string;
    }
  | {
      action: "list";
      groupId?: string;
    }
  | {
      action: "reset";
      groupId: string;
    };

type TypingCallbacks = ReturnType<typeof createTypingCallbacks>;

function toId(value: string | number | undefined): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function normalizeSenderId(raw: string): string {
  return raw.replace(/^qq:/i, "").trim();
}

function isSenderAllowed(senderId: string, allowFrom: string[]): boolean {
  if (!senderId) {
    return false;
  }
  if (allowFrom.includes("*")) {
    return true;
  }
  const normalized = normalizeSenderId(senderId);
  return allowFrom.some((entry) => normalizeSenderId(entry) === normalized);
}

function resolveGroupRule(
  account: ResolvedOneBotAccount,
  groupId: string,
): OneBotGroupRule | undefined {
  if (!groupId) return account.config.groups["*"];
  return (
    account.config.groups[groupId] ??
    account.config.groups[`qqg:${groupId}`] ??
    account.config.groups["*"]
  );
}

function extractRawBody(event: OneBotInboundEvent): string {
  const message = event.message;
  if (typeof message === "string") {
    return message.trim();
  }
  if (Array.isArray(message)) {
    const texts = message
      .map((seg) => {
        if (seg?.type === "text") {
          return String(seg.data?.text ?? "");
        }
        if (seg?.type === "at") {
          const qq = String(seg.data?.qq ?? "").trim();
          return qq ? `@${qq}` : "";
        }
        return "";
      })
      .join("")
      .trim();
    if (texts) return texts;
  }
  return String(event.raw_message ?? "").trim();
}

function detectExplicitMention(
  event: OneBotInboundEvent,
  selfId: string,
): {
  wasMentioned: boolean;
  hasAnyMention: boolean;
} {
  const sid = toId(selfId);
  if (!sid) return { wasMentioned: false, hasAnyMention: false };

  const message = event.message;
  if (!Array.isArray(message)) {
    const raw = String(event.raw_message ?? "");
    const hasAnyMention = raw.includes("[CQ:at,");
    const wasMentioned = raw.includes(`[CQ:at,qq=${sid}]`);
    return { wasMentioned, hasAnyMention };
  }

  let hasAnyMention = false;
  let wasMentioned = false;
  for (const seg of message) {
    if (seg?.type !== "at") continue;
    hasAnyMention = true;
    const qq = String(seg.data?.qq ?? "").trim();
    if (qq === sid) {
      wasMentioned = true;
      break;
    }
  }
  return { wasMentioned, hasAnyMention };
}

function markAndCheckDuplicate(messageId: string): boolean {
  const now = Date.now();
  for (const [id, ts] of seenMessageIds) {
    if (now - ts > MESSAGE_DEDUPE_TTL_MS) {
      seenMessageIds.delete(id);
    }
  }
  if (!messageId) {
    return false;
  }
  if (seenMessageIds.has(messageId)) {
    return true;
  }
  seenMessageIds.set(messageId, now);
  return false;
}

function parseGroupBindingCommand(rawBody: string): GroupBindingCommand | null {
  const text = rawBody.trim();
  const match = text.match(
    /^(?:[!/#]?onebot)\s+(grant|revoke|list|reset)(?:\s+(\S+))?(?:\s+(\S+))?$/i,
  );
  if (!match) {
    return null;
  }

  const action = (match[1] || "").toLowerCase();
  const arg1 = (match[2] || "").trim();
  const arg2 = (match[3] || "").trim();

  if (action === "grant" || action === "revoke") {
    const targetUserId = normalizeSenderId(arg1);
    const groupId = arg2
      .replace(/^qqg:/i, "")
      .replace(/^group:/i, "")
      .trim();
    if (!targetUserId || !groupId) {
      return null;
    }
    return { action, targetUserId, groupId };
  }

  if (action === "list") {
    const groupId = arg1
      ? arg1
          .replace(/^qqg:/i, "")
          .replace(/^group:/i, "")
          .trim()
      : undefined;
    return groupId ? { action, groupId } : { action };
  }

  if (action === "reset") {
    const groupId = arg1
      .replace(/^qqg:/i, "")
      .replace(/^group:/i, "")
      .trim();
    if (!groupId) {
      return null;
    }
    return { action, groupId };
  }

  return null;
}

function resolveAccountGroups(params: {
  cfg: OpenClawConfig;
  accountId: string;
}): Record<string, { allowFrom?: string[] }> {
  const channels = ((params.cfg as { channels?: Record<string, unknown> }).channels ??=
    {}) as Record<string, unknown>;
  const onebotChannel =
    (channels.onebot as
      | {
          accounts?: Record<string, Record<string, unknown>>;
          groups?: Record<string, { allowFrom?: string[] }>;
        }
      | undefined) ?? {};
  channels.onebot = onebotChannel;

  const normalizedAccountId = params.accountId.trim() || "default";
  const accountMap = (onebotChannel.accounts ??= {});
  const account = (accountMap[normalizedAccountId] ??= {});
  return ((account.groups as Record<string, { allowFrom?: string[] }> | undefined) ??=
    {}) as Record<string, { allowFrom?: string[] }>;
}

function applyGroupBindingChange(params: {
  cfg: OpenClawConfig;
  accountId: string;
  command: Extract<GroupBindingCommand, { action: "grant" | "revoke" }>;
}): { changed: boolean; nextAllowFrom: string[] } {
  const groups = resolveAccountGroups({
    cfg: params.cfg,
    accountId: params.accountId,
  });
  const groupRule = (groups[params.command.groupId] ??= {});
  const current = Array.isArray(groupRule.allowFrom)
    ? groupRule.allowFrom.map((entry) => normalizeSenderId(String(entry)))
    : [];

  const before = new Set(current);
  if (params.command.action === "grant") {
    before.add(params.command.targetUserId);
  } else {
    before.delete(params.command.targetUserId);
  }

  const nextAllowFrom = Array.from(before).filter(Boolean);
  const changed =
    nextAllowFrom.length !== current.length ||
    nextAllowFrom.some((entry, idx) => entry !== current[idx]);
  groupRule.allowFrom = nextAllowFrom;
  return { changed, nextAllowFrom };
}

function resetGroupBinding(params: { cfg: OpenClawConfig; accountId: string; groupId: string }): {
  changed: boolean;
  nextAllowFrom: string[];
} {
  const groups = resolveAccountGroups({
    cfg: params.cfg,
    accountId: params.accountId,
  });
  const groupRule = (groups[params.groupId] ??= {});
  const current = Array.isArray(groupRule.allowFrom)
    ? groupRule.allowFrom.map((entry) => normalizeSenderId(String(entry))).filter(Boolean)
    : [];
  if (current.length === 0) {
    return { changed: false, nextAllowFrom: [] };
  }
  groupRule.allowFrom = [];
  return { changed: true, nextAllowFrom: [] };
}

function listGroupBindings(params: {
  cfg: OpenClawConfig;
  accountId: string;
  groupId?: string;
}): Array<{ groupId: string; allowFrom: string[] }> {
  const groups = resolveAccountGroups({
    cfg: params.cfg,
    accountId: params.accountId,
  });

  if (params.groupId) {
    const allowFrom = Array.isArray(groups[params.groupId]?.allowFrom)
      ? groups[params.groupId]!.allowFrom!.map((entry) => normalizeSenderId(String(entry))).filter(
          Boolean,
        )
      : [];
    return [{ groupId: params.groupId, allowFrom }];
  }

  return Object.entries(groups)
    .map(([groupId, rule]) => ({
      groupId,
      allowFrom: Array.isArray(rule.allowFrom)
        ? rule.allowFrom.map((entry) => normalizeSenderId(String(entry))).filter(Boolean)
        : [],
    }))
    .sort((a, b) => a.groupId.localeCompare(b.groupId));
}

function resolveOwnerAllowFrom(account: ResolvedOneBotAccount): string[] {
  if (account.config.ownerAllowFrom.length > 0) {
    return account.config.ownerAllowFrom;
  }
  return account.config.allowFrom;
}

function shouldEnableTyping(params: {
  account: ResolvedOneBotAccount;
  isGroup: boolean;
  senderId: string;
}): boolean {
  if (params.isGroup) {
    return false;
  }
  if (!params.senderId.trim()) {
    return false;
  }
  return params.account.config.typingIndicator ?? true;
}

function createOneBotTypingCallbacks(params: {
  account: ResolvedOneBotAccount;
  isGroup: boolean;
  senderId: string;
  runtime: RuntimeEnv;
  startTyping?: () => Promise<void>;
}): TypingCallbacks | undefined {
  if (!shouldEnableTyping(params)) {
    return undefined;
  }

  const startTyping =
    params.startTyping ??
    (async () => {
      await sendOneBotAction({
        accountId: params.account.accountId,
        action: "set_input_status",
        payload: {
          user_id: params.senderId,
          event_type: 1,
        },
        timeoutMs: 3_000,
      });
    });

  return createTypingCallbacks({
    start: startTyping,
    onStartError: (err) =>
      logTypingFailure({
        log: (message) => params.runtime.error?.(message),
        channel: CHANNEL_ID,
        action: "start",
        error: err,
      }),
    keepaliveIntervalMs: ONEBOT_TYPING_KEEPALIVE_INTERVAL_MS,
    maxConsecutiveFailures: 2,
    maxDurationMs: ONEBOT_TYPING_MAX_DURATION_MS,
  });
}

async function sendPrivateText(params: {
  accountId: string;
  userId: string;
  message: string;
}): Promise<void> {
  await sendOneBotAction({
    accountId: params.accountId,
    action: "send_private_msg",
    payload: {
      user_id: /^\d+$/.test(params.userId) ? Number(params.userId) : params.userId,
      message: params.message,
    },
  });
}

function toTimestampMs(value: number | undefined): number {
  if (!value || Number.isNaN(value)) return Date.now();
  // onebot time is usually seconds
  if (value < 10_000_000_000) {
    return value * 1000;
  }
  return value;
}

async function deliverOneBotReply(params: {
  payload: OutboundReplyPayload;
  accountId: string;
  isGroup: boolean;
  senderId: string;
  groupId: string;
  statusSink?: (patch: { lastOutboundAt?: number }) => void;
}): Promise<void> {
  const combined = formatTextWithAttachmentLinks(
    params.payload.text,
    resolveOutboundMediaUrls(params.payload),
  );
  if (!combined) return;

  await sendOneBotAction({
    accountId: params.accountId,
    action: params.isGroup ? "send_group_msg" : "send_private_msg",
    payload: params.isGroup
      ? {
          group_id: /^\d+$/.test(params.groupId) ? Number(params.groupId) : params.groupId,
          message: combined,
        }
      : {
          user_id: /^\d+$/.test(params.senderId) ? Number(params.senderId) : params.senderId,
          message: combined,
        },
  });

  params.statusSink?.({ lastOutboundAt: Date.now() });
}

export async function handleOneBotInbound(params: {
  event: OneBotInboundEvent;
  account: ResolvedOneBotAccount;
  config: OpenClawConfig;
  runtime: RuntimeEnv;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
}): Promise<void> {
  const { event, account, config, runtime, statusSink } = params;
  if (event.post_type !== "message") {
    return;
  }

  const core = getOneBotRuntime();
  const senderId = toId(event.user_id);
  if (!senderId) {
    return;
  }

  const isGroup = String(event.message_type) === "group";
  const groupId = isGroup ? toId(event.group_id) : "";
  const selfId = toId(event.self_id);
  if (selfId && senderId === selfId) {
    runtime.log?.(`onebot: ignore self message ${selfId}`);
    return;
  }

  const messageSid = toId(event.message_id);
  if (messageSid && markAndCheckDuplicate(messageSid)) {
    runtime.log?.(`onebot: ignore duplicate message ${messageSid}`);
    return;
  }

  const rawBody = extractRawBody(event);
  if (!rawBody) {
    return;
  }

  const bindingCommand = !isGroup ? parseGroupBindingCommand(rawBody) : null;
  const ownerAllowFrom = resolveOwnerAllowFrom(account);
  const ownerAuthorizedForBinding =
    Boolean(bindingCommand) && isSenderAllowed(senderId, ownerAllowFrom);

  const timestampMs = toTimestampMs(event.time);
  statusSink?.({ lastInboundAt: timestampMs });

  const pairing = createScopedPairingAccess({
    core,
    channel: CHANNEL_ID,
    accountId: account.accountId,
  });

  const dmPolicy = account.config.dmPolicy ?? "pairing";
  const defaultGroupPolicy = resolveDefaultGroupPolicy(config);
  const channels = ((config as { channels?: unknown }).channels ?? {}) as Record<string, unknown>;
  const { groupPolicy, providerMissingFallbackApplied } =
    resolveAllowlistProviderRuntimeGroupPolicy({
      providerConfigPresent: channels.onebot !== undefined,
      groupPolicy: account.config.groupPolicy,
      defaultGroupPolicy,
    });

  warnMissingProviderGroupPolicyFallbackOnce({
    providerMissingFallbackApplied,
    providerKey: CHANNEL_ID,
    accountId: account.accountId,
    blockedLabel: GROUP_POLICY_BLOCKED_LABEL.group,
    log: (message) => runtime.log?.(message),
  });

  const storeAllowFrom = await readStoreAllowFromForDmPolicy({
    provider: CHANNEL_ID,
    accountId: account.accountId,
    dmPolicy,
    readStore: pairing.readStoreForDmPolicy,
  });

  const allowTextCommands = core.channel.commands.shouldHandleTextCommands({
    cfg: config,
    surface: CHANNEL_ID,
  });
  const useAccessGroups =
    (config.commands as Record<string, unknown> | undefined)?.useAccessGroups !== false;
  const hasControlCommand = core.channel.text.hasControlCommand(rawBody, config);

  const groupRule = resolveGroupRule(account, groupId);
  const effectiveGroupAllowFrom = (groupRule?.allowFrom ?? account.config.groupAllowFrom).map(
    (entry) => String(entry),
  );

  const access = resolveDmGroupAccessWithCommandGate({
    isGroup,
    dmPolicy,
    groupPolicy,
    allowFrom: account.config.allowFrom,
    groupAllowFrom: effectiveGroupAllowFrom,
    storeAllowFrom,
    isSenderAllowed: (allowFrom) => isSenderAllowed(senderId, allowFrom),
    command: {
      useAccessGroups,
      allowTextCommands,
      hasControlCommand,
    },
  });

  if (isGroup) {
    if (access.decision !== "allow") {
      runtime.log?.(`onebot: drop group sender ${senderId} (reason=${access.reason})`);
      return;
    }
  } else if (access.decision !== "allow" && !ownerAuthorizedForBinding) {
    if (access.decision === "pairing") {
      const { code, created } = await pairing.upsertPairingRequest({
        id: senderId,
        meta: { name: event.sender?.nickname || undefined },
      });
      if (created) {
        await sendPrivateText({
          accountId: account.accountId,
          userId: senderId,
          message: core.channel.pairing.buildPairingReply({
            channel: CHANNEL_ID,
            idLine: `Your QQ id: ${senderId}`,
            code,
          }),
        });
      }
    }
    runtime.log?.(`onebot: drop dm sender ${senderId} (reason=${access.reason})`);
    return;
  }

  if (bindingCommand) {
    if (!ownerAuthorizedForBinding) {
      await sendPrivateText({
        accountId: account.accountId,
        userId: senderId,
        message: "[OneBot] 仅 owner 可执行群绑定授权命令。",
      });
      return;
    }

    const loaded = core.config.loadConfig();

    if (bindingCommand.action === "list") {
      const rows = listGroupBindings({
        cfg: loaded,
        accountId: account.accountId,
        groupId: bindingCommand.groupId,
      });
      const effective = rows.filter((row) => row.allowFrom.length > 0);
      const lines = effective.length
        ? effective.map((row) => `group=${row.groupId} allowFrom=[${row.allowFrom.join(",")}]`)
        : ["无群授权记录"];
      await sendPrivateText({
        accountId: account.accountId,
        userId: senderId,
        message: `[OneBot] group allowlist:\n${lines.join("\n")}`,
      });
      return;
    }

    const nextCfg = structuredClone(loaded) as OpenClawConfig;
    const changeResult =
      bindingCommand.action === "reset"
        ? resetGroupBinding({
            cfg: nextCfg,
            accountId: account.accountId,
            groupId: bindingCommand.groupId,
          })
        : applyGroupBindingChange({
            cfg: nextCfg,
            accountId: account.accountId,
            command: bindingCommand,
          });

    if (changeResult.changed) {
      await core.config.writeConfigFile(nextCfg);
      if (bindingCommand.action === "reset") {
        core.system.enqueueSystemEvent(
          `[onebot] reset group-allow group=${bindingCommand.groupId}`,
          {
            sessionKey: `onebot:owner-binding:${account.accountId}`,
            contextKey: `onebot:group-binding:reset:${bindingCommand.groupId}`,
          },
        );
      } else {
        core.system.enqueueSystemEvent(
          `[onebot] ${bindingCommand.action} group-allow user=${bindingCommand.targetUserId} group=${bindingCommand.groupId}`,
          {
            sessionKey: `onebot:owner-binding:${account.accountId}`,
            contextKey: `onebot:group-binding:${bindingCommand.action}:${bindingCommand.groupId}:${bindingCommand.targetUserId}`,
          },
        );
      }
    }

    const summary =
      bindingCommand.action === "grant"
        ? `${changeResult.changed ? "已授权" : "无变更"}：user=${bindingCommand.targetUserId}, group=${bindingCommand.groupId}`
        : bindingCommand.action === "revoke"
          ? `${changeResult.changed ? "已移除授权" : "无变更"}：user=${bindingCommand.targetUserId}, group=${bindingCommand.groupId}`
          : `${changeResult.changed ? "已重置群授权" : "无变更"}：group=${bindingCommand.groupId}`;

    await sendPrivateText({
      accountId: account.accountId,
      userId: senderId,
      message: `[OneBot] ${summary}`,
    });
    return;
  }

  if (access.shouldBlockControlCommand) {
    runtime.log?.(`onebot: drop control command from sender ${senderId} (unauthorized)`);
    return;
  }

  const mentionRegexes = core.channel.mentions.buildMentionRegexes(config);
  const explicitMention = detectExplicitMention(event, selfId);
  const regexMention = mentionRegexes.length
    ? core.channel.mentions.matchesMentionPatterns(rawBody, mentionRegexes)
    : false;
  const wasMentioned = explicitMention.wasMentioned || regexMention;

  const shouldRequireMention = isGroup
    ? typeof groupRule?.requireMention === "boolean"
      ? groupRule.requireMention
      : true
    : false;

  const mentionGate = resolveMentionGatingWithBypass({
    isGroup,
    requireMention: shouldRequireMention,
    canDetectMention: true,
    wasMentioned,
    hasAnyMention: explicitMention.hasAnyMention,
    // strict mode: do not bypass mention for text commands
    allowTextCommands: false,
    hasControlCommand,
    commandAuthorized: access.commandAuthorized,
  });

  if (isGroup && mentionGate.shouldSkip) {
    runtime.log?.(`onebot: drop group ${groupId} (no @mention)`);
    return;
  }

  const route = core.channel.routing.resolveAgentRoute({
    cfg: config,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    peer: {
      kind: isGroup ? "group" : "direct",
      id: isGroup ? `qqg:${groupId}` : `qq:${senderId}`,
    },
  });

  const storePath = core.channel.session.resolveStorePath(
    (config.session as Record<string, unknown> | undefined)?.store as string | undefined,
    { agentId: route.agentId },
  );

  const previousTimestamp = core.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });

  const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(config);
  const body = core.channel.reply.formatAgentEnvelope({
    channel: "OneBot",
    from: isGroup ? `group:${groupId}` : `qq:${senderId}`,
    timestamp: timestampMs,
    previousTimestamp,
    envelope: envelopeOptions,
    body: rawBody,
  });

  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    BodyForAgent: rawBody,
    RawBody: rawBody,
    CommandBody: rawBody,
    From: isGroup ? `onebot:group:${groupId}` : `onebot:${senderId}`,
    To: isGroup ? `onebot:group:${groupId}` : `onebot:${selfId || "bot"}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: isGroup ? "group" : "direct",
    ConversationLabel: isGroup ? `qqg:${groupId}` : `qq:${senderId}`,
    SenderName: event.sender?.card || event.sender?.nickname || undefined,
    SenderId: senderId,
    GroupSubject: isGroup ? `qqg:${groupId}` : undefined,
    Provider: CHANNEL_ID,
    Surface: CHANNEL_ID,
    WasMentioned: isGroup ? wasMentioned : undefined,
    MessageSid: messageSid,
    Timestamp: timestampMs,
    OriginatingChannel: CHANNEL_ID,
    OriginatingTo: isGroup ? `qqg:${groupId}` : `qq:${selfId || "bot"}`,
    CommandAuthorized: access.commandAuthorized,
  });

  await core.channel.session.recordInboundSession({
    storePath,
    sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
    ctx: ctxPayload,
    onRecordError: (err) => {
      runtime.error?.(`onebot: failed updating session meta: ${String(err)}`);
    },
  });

  const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
    cfg: config,
    agentId: route.agentId,
    channel: CHANNEL_ID,
    accountId: account.accountId,
  });

  const deliverReply = createNormalizedOutboundDeliverer(async (payload) => {
    await deliverOneBotReply({
      payload,
      accountId: account.accountId,
      isGroup,
      senderId,
      groupId,
      statusSink,
    });
  });

  const typingCallbacks = createOneBotTypingCallbacks({
    account,
    isGroup,
    senderId,
    runtime,
  });

  await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg: config,
    dispatcherOptions: {
      ...prefixOptions,
      deliver: deliverReply,
      typingCallbacks,
      onError: (err, info) => {
        runtime.error?.(`onebot ${info.kind} reply failed: ${String(err)}`);
      },
    },
    replyOptions: {
      onModelSelected,
    },
  });
}

export const onebotInboundInternal = {
  normalizeSenderId,
  isSenderAllowed,
  extractRawBody,
  detectExplicitMention,
  markAndCheckDuplicate,
  parseGroupBindingCommand,
  applyGroupBindingChange,
  resetGroupBinding,
  listGroupBindings,
  resolveOwnerAllowFrom,
  shouldEnableTyping,
  createOneBotTypingCallbacks,
};
