import { describe, expect, it, vi } from "vitest";
import { onebotInboundInternal } from "./inbound.js";

describe("onebot inbound internal helpers", () => {
  it("normalizes sender id", () => {
    expect(onebotInboundInternal.normalizeSenderId("qq:123456")).toBe("123456");
    expect(onebotInboundInternal.normalizeSenderId("123456")).toBe("123456");
  });

  it("matches sender allowlist", () => {
    expect(onebotInboundInternal.isSenderAllowed("123", ["123"])).toBe(true);
    expect(onebotInboundInternal.isSenderAllowed("123", ["qq:123"])).toBe(true);
    expect(onebotInboundInternal.isSenderAllowed("123", ["*"])).toBe(true);
    expect(onebotInboundInternal.isSenderAllowed("123", ["456"])).toBe(false);
  });

  it("detects explicit mention from segment array", () => {
    const result = onebotInboundInternal.detectExplicitMention(
      {
        message: [
          { type: "at", data: { qq: "999" } },
          { type: "text", data: { text: "hello" } },
        ],
      },
      "999",
    );
    expect(result.wasMentioned).toBe(true);
    expect(result.hasAnyMention).toBe(true);
  });

  it("extracts text from array message", () => {
    const text = onebotInboundInternal.extractRawBody({
      message: [
        { type: "text", data: { text: "hi" } },
        { type: "at", data: { qq: "999" } },
      ],
    });
    expect(text).toContain("hi");
    expect(text).toContain("@999");
  });

  it("deduplicates by message id", () => {
    const first = onebotInboundInternal.markAndCheckDuplicate("abc");
    const second = onebotInboundInternal.markAndCheckDuplicate("abc");
    expect(first).toBe(false);
    expect(second).toBe(true);
  });

  it("parses group binding command", () => {
    const parsed = onebotInboundInternal.parseGroupBindingCommand(
      "onebot grant qq:12345 qqg:88888",
    );
    expect(parsed).toEqual({ action: "grant", targetUserId: "12345", groupId: "88888" });

    const listParsed = onebotInboundInternal.parseGroupBindingCommand("onebot list qqg:88888");
    expect(listParsed).toEqual({ action: "list", groupId: "88888" });

    const resetParsed = onebotInboundInternal.parseGroupBindingCommand("onebot reset group:88888");
    expect(resetParsed).toEqual({ action: "reset", groupId: "88888" });
  });

  it("applies group binding grant/revoke", () => {
    const base = {
      channels: {
        onebot: {
          accounts: {
            default: {
              groups: {
                "88888": {
                  allowFrom: ["123"],
                },
              },
            },
          },
        },
      },
    } as any;

    const grantRes = onebotInboundInternal.applyGroupBindingChange({
      cfg: base,
      accountId: "default",
      command: { action: "grant", targetUserId: "456", groupId: "88888" },
    });
    expect(grantRes.changed).toBe(true);
    expect(grantRes.nextAllowFrom).toContain("456");

    const revokeRes = onebotInboundInternal.applyGroupBindingChange({
      cfg: base,
      accountId: "default",
      command: { action: "revoke", targetUserId: "123", groupId: "88888" },
    });
    expect(revokeRes.changed).toBe(true);
    expect(revokeRes.nextAllowFrom).not.toContain("123");

    const listRes = onebotInboundInternal.listGroupBindings({
      cfg: base,
      accountId: "default",
      groupId: "88888",
    });
    expect(listRes[0]?.groupId).toBe("88888");
    expect(listRes[0]?.allowFrom).toContain("456");

    const resetRes = onebotInboundInternal.resetGroupBinding({
      cfg: base,
      accountId: "default",
      groupId: "88888",
    });
    expect(resetRes.changed).toBe(true);
    expect(resetRes.nextAllowFrom).toEqual([]);
  });

  it("enables typing only for direct chats with non-empty sender", () => {
    const account = {
      config: { typingIndicator: true },
    } as any;

    expect(
      onebotInboundInternal.shouldEnableTyping({ account, isGroup: false, senderId: "123" }),
    ).toBe(true);
    expect(
      onebotInboundInternal.shouldEnableTyping({ account, isGroup: true, senderId: "123" }),
    ).toBe(false);
    expect(
      onebotInboundInternal.shouldEnableTyping({ account, isGroup: false, senderId: "" }),
    ).toBe(false);
  });

  it("skips typing callbacks when typing indicator is disabled", () => {
    const runtime = { error: vi.fn() } as any;
    const account = {
      accountId: "default",
      config: { typingIndicator: false },
    } as any;

    const callbacks = onebotInboundInternal.createOneBotTypingCallbacks({
      account,
      isGroup: false,
      senderId: "123",
      runtime,
      startTyping: vi.fn(async () => {}),
    });

    expect(callbacks).toBeUndefined();
  });

  it("typing start failure does not reject reply lifecycle", async () => {
    const runtime = { error: vi.fn() } as any;
    const startTyping = vi.fn(async () => {
      throw new Error("typing failed");
    });
    const account = {
      accountId: "default",
      config: { typingIndicator: true },
    } as any;

    const callbacks = onebotInboundInternal.createOneBotTypingCallbacks({
      account,
      isGroup: false,
      senderId: "123",
      runtime,
      startTyping,
    });

    await expect(callbacks?.onReplyStart?.()).resolves.toBeUndefined();
    expect(startTyping).toHaveBeenCalled();
    expect(runtime.error).toHaveBeenCalled();
  });
});
