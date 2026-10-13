import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
import {
  adminClient,
  bubble,
  chromiumDevice,
  completeOnboarding,
  composer,
  conversationLink,
  createConfirmedUser,
  createInvitation,
  deleteUsers,
  findUserId,
  messages,
  newUser,
  openMessageMenu,
  PIXEL_PNG,
  sendText,
  signIn,
  signInAndOnboard,
  SKIP_REASON,
  stackConfigured,
  startDirectChat,
  userClient,
} from "../support/stack";

/**
 * End-to-end flows with independent users in separate browser contexts (separate cookies,
 * storage and realtime connections), against a real Supabase project.
 */
test.describe.configure({ mode: "serial" });
test.skip(!stackConfigured, SKIP_REASON);

const ana = newUser("Ana");
const ben = newUser("Ben");
const cat = newUser("Cat");
let anaContext: BrowserContext;
let benContext: BrowserContext;
let anaPage: Page;
let benPage: Page;
let directUrl = "";
let groupUrl = "";

async function openContext(browser: Browser) {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

test.beforeAll(async ({ browser }) => {
  // Ben and Cat are created directly; Ana goes through the real registration UI.
  await createConfirmedUser(ben);
  await createConfirmedUser(cat);
  ({ context: anaContext, page: anaPage } = await openContext(browser));
  ({ context: benContext, page: benPage } = await openContext(browser));
});

test.afterAll(async () => {
  await anaContext?.close();
  await benContext?.close();
  await deleteUsers([ana, ben, cat]);
});

test("1. user A registers (invite-aware) and signs in", async () => {
  const invite = await createInvitation();
  await anaPage.goto(`/register?invite=${invite}`);
  await anaPage.getByLabel("Display name").fill(ana.displayName);
  await anaPage.getByLabel("Email").fill(ana.email);
  await anaPage.getByLabel("Password", { exact: true }).fill(ana.password);
  await anaPage.getByLabel("Confirm password").fill(ana.password);
  const inviteField = anaPage.getByLabel("Invitation code");
  if (await inviteField.isVisible()) await expect(inviteField).toHaveValue(invite);
  await anaPage.getByRole("button", { name: "Create account" }).click();

  // Either signed straight in (confirmations off) or asked to confirm by email.
  await expect(anaPage.getByText(/Check your email|Set up your profile/)).toBeVisible({ timeout: 20_000 });
  if (await anaPage.getByText("Check your email").isVisible()) {
    ana.id = await findUserId(ana.email);
    expect(ana.id, "registered user exists").toBeTruthy();
    await adminClient().auth.admin.updateUserById(ana.id!, { email_confirm: true });
    await signIn(anaPage, ana);
  } else {
    ana.id = await findUserId(ana.email);
  }
  await completeOnboarding(anaPage, ana);
  await expect(anaPage).toHaveURL(/\/chats/);
});

test("2. user B signs in", async () => {
  await signInAndOnboard(benPage, ben);
  await expect(benPage.getByRole("navigation", { name: "Conversation list" })).toBeVisible();
});

test("3-5. A starts a chat and B receives the message without refreshing", async () => {
  await startDirectChat(anaPage, ben);
  directUrl = anaPage.url();
  await sendText(anaPage, "Hello Ben 👋");
  await expect(bubble(anaPage, "Hello Ben 👋").getByRole("img", { name: /Sent|Delivered|Read/ })).toBeVisible();

  // B is sitting on the chat list: the conversation and unread badge appear live.
  const item = conversationLink(benPage, new RegExp(ana.displayName));
  await expect(item).toBeVisible({ timeout: 15_000 });
  await expect(benPage.getByLabel("1 unread")).toBeVisible();
  await item.click();
  await expect(messages(benPage).getByText("Hello Ben 👋")).toBeVisible();
});

test("6-7. B replies; receipts and unread counts update", async () => {
  // A sees "Read" once B has the chat open and focused.
  await expect(bubble(anaPage, "Hello Ben 👋").getByRole("img", { name: "Read" })).toBeVisible({ timeout: 15_000 });

  await benPage.bringToFront();
  await sendText(benPage, "Hi Ana!");
  await expect(messages(anaPage).getByText("Hi Ana!")).toBeVisible({ timeout: 15_000 });
  await expect(benPage.getByLabel(/unread/)).toHaveCount(0);
});

test("typing indicator reaches the other user", async () => {
  await composer(benPage).pressSequentially("typing something", { delay: 30 });
  await expect(anaPage.getByText(/is typing/)).toBeVisible({ timeout: 10_000 });
  await composer(benPage).fill("");
});

test("8. replies, reactions and edits work", async () => {
  await openMessageMenu(anaPage, "Hi Ana!");
  await anaPage.getByRole("menuitem", { name: "Reply" }).click();
  await expect(anaPage.getByText(`Replying to ${ben.displayName}`)).toBeVisible();
  await sendText(anaPage, "Replying to you");
  const reply = bubble(benPage, "Replying to you");
  await expect(reply).toBeVisible({ timeout: 15_000 });
  await expect(reply.getByRole("button", { name: "Jump to the replied message" })).toContainText("Hi Ana!");

  await openMessageMenu(benPage, "Replying to you");
  await benPage.getByRole("menuitem", { name: "React with 👍" }).click();
  await expect(bubble(anaPage, "Replying to you").getByRole("button", { name: /^👍/ })).toBeVisible({ timeout: 15_000 });

  await openMessageMenu(anaPage, "Replying to you");
  await anaPage.getByRole("menuitem", { name: "Edit" }).click();
  await composer(anaPage).fill("Replying to you (edited)");
  await composer(anaPage).press("Enter");
  await expect(bubble(benPage, "Replying to you (edited)")).toContainText("edited", { timeout: 15_000 });
});

test("9. users create a group and exchange messages", async () => {
  await anaPage.goto("/chats");
  await anaPage.getByRole("button", { name: "New chat" }).click();
  await anaPage.getByRole("button", { name: "New group" }).click();
  await anaPage.getByLabel("Group name").fill("E2E Group");
  await anaPage.getByLabel("Search people").fill(ben.username);
  await anaPage.getByRole("option", { name: new RegExp(ben.displayName) }).click();
  await anaPage.getByRole("button", { name: "Create group" }).click();
  await anaPage.waitForURL(/\/chats\/[0-9a-f-]{36}/);
  groupUrl = anaPage.url();

  await sendText(anaPage, `Welcome @${ben.username}`);
  await benPage.goto(groupUrl);
  await expect(messages(benPage).getByText(`@${ben.username}`)).toBeVisible();
  await sendText(benPage, "Thanks for adding me");
  await expect(messages(anaPage).getByText("Thanks for adding me")).toBeVisible({ timeout: 15_000 });
});

test("10. attachments are shared with members and denied to everyone else", async () => {
  await anaPage.locator('input[type="file"][multiple]').setInputFiles({ name: "pixel.png", mimeType: "image/png", buffer: PIXEL_PNG });
  await expect(anaPage.getByRole("button", { name: "Remove pixel.png" })).toBeVisible({ timeout: 20_000 });
  await anaPage.getByRole("button", { name: "Send message" }).click();
  await expect(benPage.getByRole("img", { name: "pixel.png" })).toBeVisible({ timeout: 20_000 });

  const groupId = groupUrl.split("/").pop()!;
  const { data: attachment } = await adminClient()
    .from("attachments")
    .select("storage_path")
    .eq("conversation_id", groupId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  expect(attachment?.storage_path).toBeTruthy();

  // Ben (member) can get a link; Cat (not a member) cannot read the file or the messages.
  const benApi = await userClient(ben);
  expect((await benApi.storage.from("attachments").createSignedUrl(attachment!.storage_path, 60)).error).toBeNull();
  const catApi = await userClient(cat);
  expect((await catApi.storage.from("attachments").createSignedUrl(attachment!.storage_path, 60)).error).not.toBeNull();
  expect((await catApi.storage.from("attachments").download(attachment!.storage_path)).error).not.toBeNull();
  const { data: leaked } = await catApi.from("messages").select("id").eq("conversation_id", groupId);
  expect(leaked ?? []).toHaveLength(0);
});

test("11. blocking stops messages in the direct chat", async () => {
  await benPage.goto(directUrl);
  await benPage.getByRole("button", { name: "Conversation options" }).click();
  await benPage.getByRole("menuitem", { name: "Block" }).click();
  await expect(benPage.getByText(`You blocked ${ana.displayName}.`)).toBeVisible();

  await anaPage.goto(directUrl);
  await sendText(anaPage, "Are you there?");
  await expect(bubble(anaPage, "Are you there?")).toContainText("You cannot send messages in this conversation", { timeout: 15_000 });

  await benPage.getByRole("button", { name: "Unblock" }).click();
  await expect(composer(benPage)).toBeVisible();
});

test("12. conversations and messages persist after a refresh", async () => {
  await anaPage.goto(directUrl);
  await anaPage.reload();
  await expect(messages(anaPage).getByText("Hello Ben 👋")).toBeVisible();
  await expect(messages(anaPage).getByText("Hi Ana!")).toBeVisible();
});

test("13. mobile layout shows one pane at a time without horizontal scrolling", async ({ browser }) => {
  const context = await browser.newContext(chromiumDevice("iPhone 13"));
  const page = await context.newPage();
  await signIn(page, ana);
  await expect(page.getByRole("navigation", { name: "Conversation list" })).toBeVisible();
  await conversationLink(page, new RegExp(ben.displayName)).click();
  await expect(composer(page)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Conversation list" })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  await page.getByRole("link", { name: "Back to conversations" }).click();
  await expect(page.getByRole("navigation", { name: "Conversation list" })).toBeVisible();
  await context.close();
});

test("14. going offline shows a clear failed state and recovers", async () => {
  await anaPage.goto(directUrl);
  await anaContext.setOffline(true);
  await sendText(anaPage, "Sent while offline");
  await expect(bubble(anaPage, "Sent while offline")).toContainText(/offline/i, { timeout: 10_000 });
  await anaContext.setOffline(false);
  // Network-failed sends retry automatically when the connection returns.
  await expect(bubble(anaPage, "Sent while offline").getByText(/offline/i)).toHaveCount(0, { timeout: 20_000 });
  await expect(messages(benPage).getByText("Sent while offline")).toBeVisible({ timeout: 20_000 });
});
