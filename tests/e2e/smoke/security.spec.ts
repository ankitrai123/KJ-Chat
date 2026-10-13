import { expect, test } from "@playwright/test";

test.describe("security headers", () => {
  test("HTML responses carry a nonce-based CSP and hardening headers", async ({ request }) => {
    const response = await request.get("/login");
    expect(response.status()).toBe(200);
    const headers = response.headers();
    const csp = headers["content-security-policy"];
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("camera=(self)");
    expect(headers["x-powered-by"]).toBeUndefined();

    // Every script tag in the page carries this request's nonce.
    const nonce = /'nonce-([^']+)'/.exec(csp)![1];
    const html = await response.text();
    const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    expect(scripts.length).toBeGreaterThan(0);
    for (const tag of scripts) expect(tag).toContain(`nonce="${nonce}"`);
  });

  test("nonces differ per request", async ({ request }) => {
    const a = (await request.get("/login")).headers()["content-security-policy"];
    const b = (await request.get("/login")).headers()["content-security-policy"];
    expect(a).not.toBe(b);
  });

  test("pages load without CSP violations or console errors", async ({ page }) => {
    const problems: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") problems.push(msg.text());
    });
    page.on("pageerror", (err) => problems.push(err.message));
    for (const path of ["/login", "/register", "/forgot-password", "/offline"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
    }
    // Requests to the deliberately unreachable backend are expected; anything else is a bug.
    expect(problems.filter((p) => !/127\.0\.0\.1:59999|ERR_CONNECTION_REFUSED|Failed to load resource/.test(p))).toEqual([]);
  });
});

test.describe("API protection", () => {
  test("rejects unauthenticated requests", async ({ request, baseURL }) => {
    const response = await request.post("/api/messages", {
      headers: { "Content-Type": "application/json", Origin: baseURL! },
      data: { conversationId: "00000000-0000-4000-8000-000000000000", clientId: "00000000-0000-4000-8000-000000000001", content: "hi" },
    });
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.error.kind).toBe("unauthenticated");
    expect(JSON.stringify(body)).not.toMatch(/SECRET|stack|at \w+ \(/);
  });

  test("rejects cross-site requests before doing any work (CSRF)", async ({ request }) => {
    const response = await request.post("/api/calls", {
      headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
      data: { conversationId: "00000000-0000-4000-8000-000000000000", mediaType: "video" },
    });
    expect(response.status()).toBe(403);
  });

  test("rejects non-JSON bodies", async ({ request, baseURL }) => {
    const response = await request.post("/api/messages", {
      headers: { "Content-Type": "text/plain", Origin: baseURL! },
      data: "hello",
    });
    expect(response.status()).toBe(415);
  });

  test("rejects unsigned LiveKit webhooks and unauthenticated cron calls", async ({ request }) => {
    const webhook = await request.post("/api/livekit/webhook", {
      headers: { "Content-Type": "application/webhook+json", Authorization: "Bearer forged" },
      data: JSON.stringify({ event: "room_finished", room: { name: "call_x" } }),
    });
    expect(webhook.status()).toBe(401);
    expect((await request.get("/api/cron/maintenance")).status()).toBe(401);
    expect((await request.get("/api/cron/maintenance", { headers: { Authorization: "Bearer wrong" } })).status()).toBe(401);
  });

  test("health check exposes booleans only", async ({ request }) => {
    const body = await (await request.get("/api/health")).json();
    for (const value of Object.values(body)) expect(typeof value).toBe("boolean");
    expect(JSON.stringify(body)).not.toContain("SECRET_CANARY");
  });
});
