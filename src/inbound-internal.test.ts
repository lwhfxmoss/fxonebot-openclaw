import { describe, expect, it } from "vitest";
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
});
