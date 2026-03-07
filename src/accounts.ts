import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk";
import type { OneBotAccountRaw, OneBotChannelRaw, ResolvedOneBotAccount } from "./types.js";

function getChannel(cfg: OpenClawConfig): OneBotChannelRaw {
  const channels = ((cfg as { channels?: unknown }).channels ?? {}) as Record<string, unknown>;
  return (channels.onebot as OneBotChannelRaw | undefined) ?? {};
}

function toStringList(values: Array<string | number> | undefined): string[] {
  return (values ?? []).map((entry) => String(entry).trim()).filter(Boolean);
}

export function listOneBotAccountIds(cfg: OpenClawConfig): string[] {
  const channel = getChannel(cfg);
  const ids = new Set<string>();
  if (channel.accounts && Object.keys(channel.accounts).length > 0) {
    for (const id of Object.keys(channel.accounts)) {
      ids.add(normalizeAccountId(id));
    }
  }
  if (channel.wsReverse || channel.dmPolicy || channel.groupPolicy || channel.allowFrom) {
    ids.add(DEFAULT_ACCOUNT_ID);
  }
  return Array.from(ids);
}

export function resolveDefaultOneBotAccountId(cfg: OpenClawConfig): string {
  const ids = listOneBotAccountIds(cfg);
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

function resolveWsReverse(base: OneBotChannelRaw, account: OneBotAccountRaw | undefined) {
  const merged = {
    host: account?.wsReverse?.host ?? base.wsReverse?.host ?? "0.0.0.0",
    port: account?.wsReverse?.port ?? base.wsReverse?.port ?? 6198,
    path: account?.wsReverse?.path ?? base.wsReverse?.path ?? "/onebot/v11/ws",
    token: account?.wsReverse?.token ?? base.wsReverse?.token ?? "",
  };
  return {
    host: String(merged.host),
    port: Number(merged.port),
    path: String(merged.path),
    token: String(merged.token),
  };
}

export function resolveOneBotAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): ResolvedOneBotAccount {
  const channel = getChannel(params.cfg);
  const accountId = normalizeAccountId(params.accountId ?? DEFAULT_ACCOUNT_ID);
  const account = channel.accounts?.[accountId] as OneBotAccountRaw | undefined;

  const dmPolicy = account?.dmPolicy ?? channel.dmPolicy ?? "pairing";
  const groupPolicy = account?.groupPolicy ?? channel.groupPolicy ?? "allowlist";
  const allowFrom = toStringList(account?.allowFrom ?? channel.allowFrom);
  const ownerAllowFrom = toStringList(account?.ownerAllowFrom ?? channel.ownerAllowFrom);
  const groupAllowFrom = toStringList(account?.groupAllowFrom ?? channel.groupAllowFrom);
  const groups = account?.groups ?? channel.groups ?? {};
  const wsReverse = resolveWsReverse(channel, account);
  const typingIndicator = account?.typingIndicator ?? channel.typingIndicator ?? true;

  const configured = Boolean(wsReverse.token && wsReverse.path && wsReverse.port);

  return {
    accountId,
    enabled: account?.enabled ?? channel.enabled ?? true,
    configured,
    name: account?.name,
    config: {
      dmPolicy,
      allowFrom,
      ownerAllowFrom,
      groupPolicy,
      groupAllowFrom,
      groups,
      defaultTo: account?.defaultTo,
      typingIndicator,
      wsReverse,
    },
  };
}
