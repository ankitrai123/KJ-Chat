import { expect, test } from "@playwright/test";

test.describe("routing for signed-out visitors", () => {
  test("protected pages redirect to sign-in and keep the destination", async ({ page }) => {
    await page.goto("/chats/00000000-0000-4000-8000-000000000000?message=x");
    await expect(page).toHaveURL(/\/login\?next=%2Fchats%2F00000000-0000-4000-8000-000000000000%3Fmessage%3Dx/);
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();

    await page.goto("/settings");
    await expect(page).toHaveURL(/\/login\?next=%2Fsettings/);

    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("auth pages are reachable", async ({ page }) => {
    for (const [path, heading] of [
      ["/login", "Welcome back"],
      ["/register", "Create your account"],
      ["/forgot-password", "Reset your password"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }
  });
});

test.describe("sign-in form", () => {
  test("validates input before contacting the server", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Enter your email address.")).toBeVisible();
    await expect(page.getByText("Enter your password.")).toBeVisible();

    await page.getByLabel("Email").fill("not-an-email");
    await page.getByLabel("Password").fill("whatever");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Enter a valid email address.")).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
  });

  test("explains when the server is unreachable", async ({ page }) => {
    // The smoke build points Supabase at a closed port.
    await page.goto("/login");
    await page.getByLabel("Email").fill("ana@example.com");
    await page.getByLabel("Password").fill("correct horse battery");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Can't reach the server" })).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("registration form", () => {
  test("requires matching passwords and shows the invite field when the mode is unknown", async ({ page }) => {
    await page.goto("/register?invite=abc123");
    await expect(page.getByLabel("Invitation code")).toHaveValue("abc123");
    await page.getByLabel("Display name").fill("Ana");
    await page.getByLabel("Email").fill("ana@example.com");
    await page.getByLabel("Password", { exact: true }).fill("correct horse");
    await page.getByLabel("Confirm password").fill("different");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Passwords do not match.")).toBeVisible();
  });

  test("reports network failures instead of failing silently", async ({ page }) => {
    await page.goto("/register");
    await page.getByLabel("Display name").fill("Ana");
    await page.getByLabel("Email").fill("ana@example.com");
    await page.getByLabel("Password", { exact: true }).fill("correct horse");
    await page.getByLabel("Confirm password").fill("correct horse");
    await page.getByLabel("Invitation code").fill("code");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /reach the server|invalid|expired/i }).first()).toBeVisible();
  });
});

test("password reset reports network failures", async ({ page }) => {
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill("ana@example.com");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Can't reach the server" })).toBeVisible();
});

test("auth email links with bad tokens explain what happened", async ({ page }) => {
  await page.goto("/auth/confirm?token_hash=bogus&type=email");
  await expect(page).toHaveURL(/\/login\?message=/);
  await expect(page.getByText("That link is invalid or has expired")).toBeVisible();
});
