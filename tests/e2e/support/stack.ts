import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { devices, expect, type Locator, type Page } from "@playwright/test";

/**
 * Helpers for tests that run against a real stack (deployed app + Supabase project).
 * Required env:
 *   E2E_BASE_URL                  e.g. http://localhost:3000 or the deployed URL
 *   E2E_SUPABASE_URL              the same project the app uses
 *   E2E_SUPABASE_PUBLISHABLE_KEY  publishable/anon key (for "another user" API checks)
 *   E2E_SUPABASE_SECRET_KEY       secret/service key (creates invitations, confirms and deletes test users)
 * Use a dedicated test project: the suite creates and deletes users.
 */
export const stack = {
  baseURL: process.env.E2E_BASE_URL ?? "",
  supabaseUrl: process.env.E2E_SUPABASE_URL ?? "",
  publishableKey: process.env.E2E_SUPABASE_PUBLISHABLE_KEY ?? "",
  secretKey: process.env.E2E_SUPABASE_SECRET_KEY ?? "",
};

export const stackConfigured = Boolean(stack.baseURL && stack.supabaseUrl && stack.publishableKey && stack.secretKey);
export const SKIP_REASON = "Set E2E_BASE_URL, E2E_SUPABASE_URL, E2E_SUPABASE_PUBLISHABLE_KEY and E2E_SUPABASE_SECRET_KEY to run against a real stack.";

let admin: SupabaseClient | null = null;
export function adminClient(): SupabaseClient {
  admin ??= createClient(stack.supabaseUrl, stack.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}

export interface E2EUser {
  label: string;
  email: string;
  password: string;
  displayName: string;
  username: string;
  id?: string;
}

export function newUser(label: string): E2EUser {
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return {
    label,
    email: `kj-e2e-${label.toLowerCase()}-${tag}@example.com`,
    password: `Pw-${tag}-correct-horse`,
    displayName: `${label} Tester`,
    username: `e2e_${label.toLowerCase()}_${tag}`.slice(0, 30),
  };
}

/** Creates a confirmed user through the Admin API (bypasses invite-only mode by design). */
export async function createConfirmedUser(user: E2EUser): Promise<E2EUser> {
  const { data, error } = await adminClient().auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
    user_metadata: { display_name: user.displayName },
    app_metadata: { kj_admin_created: true },
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  user.id = data.user.id;
  return user;
}

export async function findUserId(email: string): Promise<string | undefined> {
  for (let page = 1; page <= 20; page += 1) {
    const { data } = await adminClient().auth.admin.listUsers({ page, perPage: 200 });
    const match = data?.users.find((u) => u.email === email);
    if (match) return match.id;
    if (!data || data.users.length < 200) return undefined;
  }
  return undefined;
}

export async function deleteUsers(users: E2EUser[]) {
  for (const user of users) {
    const id = user.id ?? (await findUserId(user.email));
    if (id) await adminClient().auth.admin.deleteUser(id).catch(() => undefined);
  }
}

export async function createInvitation(): Promise<string> {
  const { data, error } = await adminClient().from("app_invitations").insert({ max_uses: 1, note: "e2e" }).select("code").single();
  if (error || !data) throw new Error(`invitation failed: ${error?.message}`);
  return data.code as string;
}

/** A user-scoped API client, to prove what another user can and can't read. */
export async function userClient(user: E2EUser): Promise<SupabaseClient> {
  const client = createClient(stack.supabaseUrl, stack.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error) throw new Error(`sign-in failed for ${user.label}: ${error.message}`);
  return client;
}

// ------------------------------------------------------------------ UI helpers

export async function signIn(page: Page, user: E2EUser) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(chats|onboarding)/);
}

export async function completeOnboarding(page: Page, user: E2EUser) {
  if (!page.url().includes("/onboarding")) await page.goto("/onboarding");
  if (!page.url().includes("/onboarding")) return; // already onboarded
  await page.getByLabel("Username").fill(user.username);
  await expect(page.getByText("✓ Available")).toBeVisible();
  await page.getByLabel("Display name").fill(user.displayName);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/\/chats/);
}

export async function signInAndOnboard(page: Page, user: E2EUser) {
  await signIn(page, user);
  await completeOnboarding(page, user);
}

export function composer(page: Page): Locator {
  return page.getByLabel("Message", { exact: true });
}

export async function sendText(page: Page, text: string) {
  const box = composer(page);
  await box.fill(text);
  await box.press("Enter");
}

export function messages(page: Page): Locator {
  return page.getByRole("log", { name: "Messages" });
}

export function bubble(page: Page, text: string): Locator {
  return page.locator("[data-message-id]").filter({ hasText: text }).last();
}

export async function openMessageMenu(page: Page, text: string) {
  const target = bubble(page, text);
  await target.hover();
  await target.getByRole("button", { name: "Message options" }).click();
}

export async function startDirectChat(page: Page, other: E2EUser) {
  await page.getByRole("button", { name: "New chat" }).click();
  await page.getByLabel("Search people").fill(other.username);
  await page.getByRole("option", { name: new RegExp(other.displayName) }).click();
  await page.waitForURL(/\/chats\/[0-9a-f-]{36}/);
}

export function conversationLink(page: Page, title: string | RegExp): Locator {
  return page.getByRole("navigation", { name: "Conversation list" }).getByRole("link", { name: title });
}

/** 1x1 PNG. */
export const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

/** A device descriptor for Chromium (drops the WebKit default some phone presets carry). */
export function chromiumDevice(name: keyof typeof devices) {
  const { defaultBrowserType, ...descriptor } = devices[name];
  void defaultBrowserType;
  return descriptor;
}
