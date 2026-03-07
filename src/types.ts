export type OneBotGroupRule = {
  enabled?: boolean;
  requireMention?: boolean;
  allowFrom?: Array<string | number>;
};

export type OneBotWsReverseConfig = {
  host?: string;
  port?: number;
  path?: string;
  token?: string;
};

export type OneBotAccountRaw = {
  enabled?: boolean;
  name?: string;
  wsReverse?: OneBotWsReverseConfig;
  dmPolicy?: "open" | "allowlist" | "pairing" | "disabled";
  allowFrom?: Array<string | number>;
  ownerAllowFrom?: Array<string | number>;
  groupPolicy?: "open" | "allowlist" | "disabled";
  groupAllowFrom?: Array<string | number>;
  groups?: Record<string, OneBotGroupRule>;
  defaultTo?: string;
  typingIndicator?: boolean;
};

export type OneBotChannelRaw = {
  enabled?: boolean;
  accounts?: Record<string, OneBotAccountRaw>;
  dmPolicy?: OneBotAccountRaw["dmPolicy"];
  allowFrom?: OneBotAccountRaw["allowFrom"];
  ownerAllowFrom?: OneBotAccountRaw["ownerAllowFrom"];
  groupPolicy?: OneBotAccountRaw["groupPolicy"];
  groupAllowFrom?: OneBotAccountRaw["groupAllowFrom"];
  groups?: OneBotAccountRaw["groups"];
  wsReverse?: OneBotWsReverseConfig;
  typingIndicator?: OneBotAccountRaw["typingIndicator"];
};

export type ResolvedOneBotAccount = {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  name?: string;
  config: {
    dmPolicy: NonNullable<OneBotAccountRaw["dmPolicy"]>;
    allowFrom: string[];
    ownerAllowFrom: string[];
    groupPolicy: NonNullable<OneBotAccountRaw["groupPolicy"]>;
    groupAllowFrom: string[];
    groups: Record<string, OneBotGroupRule>;
    defaultTo?: string;
    typingIndicator: boolean;
    wsReverse: Required<OneBotWsReverseConfig>;
  };
};
