import { describe, expect, it } from "vitest";
import {
  EDIT_WINDOW_MS,
  canDeleteForEveryone,
  canEditGroupInfo,
  canEditMessage,
  canPinMessages,
  memberActions,
} from "@/lib/chat/permissions";

const NOW = Date.parse("2026-10-13T12:00:00Z");
const message = (overrides: Partial<Parameters<typeof canEditMessage>[0]> = {}) => ({
  message_type: "text" as const,
  deleted_at: null,
  created_at: new Date(NOW - 60_000).toISOString(),
  ...overrides,
});

describe("message permissions (mirror edit_message / delete_message / pin_message)", () => {
  it("lets senders edit their own recent text and media messages only", () => {
    expect(canEditMessage(message(), true, NOW)).toBe(true);
    expect(canEditMessage(message({ message_type: "image" }), true, NOW)).toBe(true);
    expect(canEditMessage(message(), false, NOW)).toBe(false);
  });

  it("closes the edit window after 48 hours", () => {
    const old = message({ created_at: new Date(NOW - EDIT_WINDOW_MS - 1).toISOString() });
    const edge = message({ created_at: new Date(NOW - EDIT_WINDOW_MS + 1000).toISOString() });
    expect(canEditMessage(old, true, NOW)).toBe(false);
    expect(canEditMessage(edge, true, NOW)).toBe(true);
  });

  it("never offers editing for voice notes, system/call entries, deleted or unsent messages", () => {
    for (const type of ["voice", "system", "call"] as const) {
      expect(canEditMessage(message({ message_type: type }), true, NOW)).toBe(false);
    }
    expect(canEditMessage(message({ deleted_at: new Date(NOW).toISOString() }), true, NOW)).toBe(false);
    expect(canEditMessage(message({ localStatus: "pending" }), true, NOW)).toBe(false);
    expect(canEditMessage(message({ localStatus: "failed" }), true, NOW)).toBe(false);
  });

  it("allows delete-for-everyone for the sender, or group admins on others' messages", () => {
    expect(canDeleteForEveryone(message(), true, false, "member")).toBe(true);
    expect(canDeleteForEveryone(message(), false, false, "owner")).toBe(false); // direct chats: own messages only
    expect(canDeleteForEveryone(message(), false, true, "member")).toBe(false);
    expect(canDeleteForEveryone(message(), false, true, "admin")).toBe(true);
    expect(canDeleteForEveryone(message(), false, true, "owner")).toBe(true);
    expect(canDeleteForEveryone(message({ message_type: "system" }), false, true, "owner")).toBe(false);
    expect(canDeleteForEveryone(message({ deleted_at: new Date(NOW).toISOString() }), true, false, "member")).toBe(false);
  });

  it("lets anyone pin in direct chats but only admins in groups", () => {
    expect(canPinMessages(false, "member")).toBe(true);
    expect(canPinMessages(true, "member")).toBe(false);
    expect(canPinMessages(true, "admin")).toBe(true);
    expect(canPinMessages(true, null)).toBe(false);
  });
});

describe("group permissions (mirror remove_group_member / set_group_member_role / update_group)", () => {
  it("restricts group settings to owners and admins", () => {
    expect(canEditGroupInfo("owner")).toBe(true);
    expect(canEditGroupInfo("admin")).toBe(true);
    expect(canEditGroupInfo("member")).toBe(false);
    expect(canEditGroupInfo(undefined)).toBe(false);
  });

  it("gives members no management actions", () => {
    expect(memberActions("member", "member", false)).toEqual({ remove: false, promote: false, demote: false, transferOwnership: false });
  });

  it("lets admins remove and promote members but not touch other admins or the owner", () => {
    expect(memberActions("admin", "member", false)).toEqual({ remove: true, promote: true, demote: false, transferOwnership: false });
    expect(memberActions("admin", "admin", false)).toEqual({ remove: false, promote: false, demote: false, transferOwnership: false });
    expect(memberActions("admin", "owner", false).remove).toBe(false);
  });

  it("lets the owner manage admins and transfer ownership", () => {
    expect(memberActions("owner", "admin", false)).toEqual({ remove: true, promote: false, demote: true, transferOwnership: true });
    expect(memberActions("owner", "member", false)).toEqual({ remove: true, promote: true, demote: false, transferOwnership: true });
  });

  it("offers nothing on your own row (leaving is a separate action)", () => {
    expect(memberActions("owner", "owner", true)).toEqual({ remove: false, promote: false, demote: false, transferOwnership: false });
  });
});
