import { describe, expect, it } from "vitest";
import { AppError, fromDatabaseError, toUserMessage } from "@/lib/errors";
import { safeNextPath } from "@/lib/routes";
import { buildContentSecurityPolicy, createNonce } from "@/lib/security/csp";
import { assertSameOrigin } from "@/lib/security/origin";

describe("safeNextPath (open-redirect protection)", () => {
  it("allows same-site paths only", () => {
    expect(safeNextPath("/chats/abc?message=1")).toBe("/chats/abc?message=1");
    expect(safeNextPath("https://evil.example")).toBe("/chats");
    expect(safeNextPath("//evil.example")).toBe("/chats");
    expect(safeNextPath("/\\evil.example")).toBe("/chats");
    expect(safeNextPath("/x\r\nSet-Cookie: a=b")).toBe("/chats");
    expect(safeNextPath(null, "/onboarding")).toBe("/onboarding");
  });
});

describe("assertSameOrigin (CSRF protection)", () => {
  const request = (headers: Record<string, string>, method = "POST") => new Request("https://app.example/api/x", { method, headers });

  it("accepts same-origin JSON requests", () => {
    expect(() => assertSameOrigin(request({ origin: "https://app.example", host: "app.example", "content-type": "application/json" }))).not.toThrow();
  });

  it("rejects cross-site requests and non-JSON bodies", () => {
    expect(() => assertSameOrigin(request({ origin: "https://evil.example", host: "app.example", "content-type": "application/json" }))).toThrow(AppError);
    expect(() => assertSameOrigin(request({ origin: "https://app.example", host: "app.example", "content-type": "text/plain" }))).toThrow(/JSON/);
    expect(() => assertSameOrigin(request({ origin: "null", host: "app.example", "content-type": "application/json" }))).toThrow(AppError);
  });

  it("ignores safe methods", () => {
    expect(() => assertSameOrigin(request({ origin: "https://evil.example" }, "GET"))).not.toThrow();
  });
});

describe("content security policy", () => {
  it("uses a nonce for scripts and allows only the configured backends", () => {
    const csp = buildContentSecurityPolicy({ nonce: "abc", supabaseUrl: "https://ref123.supabase.co", livekitUrl: "wss://proj.livekit.cloud", isDev: false });
    expect(csp).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(csp).not.toContain("unsafe-eval");
    const connect = csp.split("; ").find((d) => d.startsWith("connect-src"))!.split(" ").slice(1);
    expect(connect).toEqual(
      expect.arrayContaining([
        "'self'",
        "https://ref123.supabase.co",
        "wss://ref123.supabase.co",
        "https://ref123.storage.supabase.co",
        "wss://proj.livekit.cloud",
        "https://*.livekit.cloud",
      ]),
    );
    expect(connect.some((source) => source.includes("*") && !source.includes("livekit.cloud"))).toBe(false);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("allows eval only in development", () => {
    expect(buildContentSecurityPolicy({ nonce: "n", supabaseUrl: "http://127.0.0.1:54321", isDev: true })).toContain("'unsafe-eval'");
  });

  it("creates unpredictable nonces", () => {
    expect(createNonce()).not.toBe(createNonce());
    expect(createNonce()).toMatch(/^[A-Za-z0-9+/=]{24}$/);
  });
});

describe("error mapping", () => {
  it("keeps readable messages from our database functions", () => {
    const err = fromDatabaseError({ code: "42501", message: "You cannot send messages in this conversation.", hint: "blocked" });
    expect(err).toMatchObject({ kind: "forbidden", status: 403, hint: "blocked", message: "You cannot send messages in this conversation." });
  });

  it("hides technical messages", () => {
    expect(fromDatabaseError({ code: "42501", message: 'permission denied for table messages' }).message).toBe("You don't have permission to do that.");
    expect(fromDatabaseError({ code: "XX000", message: "internal: stack trace with secrets" }).message).toBe("Something went wrong.");
    expect(fromDatabaseError({ code: "23505", message: 'duplicate key value violates unique constraint "profiles_username_key"' }).message).toBe(
      "That username is already taken.",
    );
  });

  it("produces user messages for any thrown value", () => {
    expect(toUserMessage(new AppError("invalid", "Bad input"))).toBe("Bad input");
    expect(toUserMessage(new TypeError("Failed to fetch"))).toMatch(/offline/);
    expect(toUserMessage("weird")).toBe("Something went wrong. Please try again.");
  });
});
