# KJ Chat

A private, self-hosted chat app for friends, family or a small team: one-to-one and group
messaging in real time, photos/videos/files/voice notes, and audio/video calls with screen
sharing. It runs on **Next.js** (Vercel), **Supabase** (auth, Postgres, Realtime, Storage) and
**LiveKit Cloud** (WebRTC media).

> **Current state:** see [`PROJECT_STATUS.md`](PROJECT_STATUS.md) for what is complete, what has
> been verified (and how), and what still needs live credentials to verify.

- [Features](#features)
- [Architecture](#architecture)
- [Security model](#security-model)
- [Local development](#local-development)
- [Configuration](#configuration)
- [Testing](#testing)
- [Deployment](#deployment-vercel--supabase--livekit-cloud)
- [Troubleshooting](#troubleshooting)
- [Privacy, retention and limitations](#privacy-retention-and-limitations)

## Features

**Accounts** — email + password sign-up with email confirmation, password reset, sign out (this
device / everywhere), account deletion. Registration is **invite-only by default**: the first
account becomes the administrator and can create invitation codes or open registration in
`/admin`. Unique usernames, display name, avatar, bio.

**Messaging** — direct chats and groups; text (with safe auto-linking, no HTML rendering),
replies, emoji reactions, edit (48 h window, "edited" label), delete for me / for everyone,
forward, pin, copy, @mentions in groups, message info (delivered/read per member), per-chat and
global search, infinite history, jump to replied/searched message, unread separator and badges.
Sending is idempotent (client-generated ids): retries never duplicate, failed messages stay in
the chat with **Retry**, and failed text messages survive a reload.

**Media** — images (with lightbox), video, audio, documents and voice notes (record, preview,
cancel). Multiple attachments per message, upload progress with cancel/retry, drag-and-drop and
paste. Files are type-checked by content on the server, stored in a **private** bucket and shown
through short-lived signed URLs.

**Realtime** — new messages, edits, deletions, reactions, receipts and membership changes update
live; typing indicators; online presence and last seen (privacy-controlled); reconnect banner with
automatic catch-up.

**Groups** — create with name/photo/description, add/remove members, admin/owner roles, transfer
ownership, leave/delete, expiring invite links (`/join/<token>`), system messages for membership
changes.

**Calls (LiveKit)** — 1:1 and group voice/video calls, incoming-call screen with ringtone,
accept/decline, busy and missed-call handling, mute/camera toggles, device selection, screen
sharing (desktop), active-speaker grid, pin/spotlight, picture-in-picture, reconnection, host
moderation (mute/remove), call log messages with duration.

**Notifications** — unread counts, in-app toasts, browser notifications, optional Web Push
(VAPID) with per-chat mute, quiet hours, preview hiding and per-type preferences.

**Privacy & safety** — block/unblock (blocks messaging and calls both ways), report messages or
users (admin review queue), last-seen / online / read-receipt visibility settings, clear chat,
archive, mute, pin chats.

**App** — responsive (phone → desktop), light/dark/system theme, installable PWA with offline
fallback page, keyboard accessible, reduced-motion aware.

## Architecture

```
Browser (Next.js client)                     Vercel (Next.js server)                 Supabase
─────────────────────────                    ───────────────────────                 ────────
Pages, TanStack Query cache   ── reads ──▶   (none: reads go straight to Supabase)  Postgres + RLS
supabase-js (publishable key) ── RPC/REST ─────────────────────────────────────▶   (every row checked
supabase-js Realtime          ◀── Postgres Changes / private Broadcast/Presence ─   against auth.uid())
                              ── POST /api/messages ──▶ verify JWT, verify uploaded
                                                       files by content, call
                                                       send_message (secret key) ──▶ service-only RPC
                              ── POST /api/calls ─────▶ start/join call in DB,
                                                       mint 10-min LiveKit token ──▶ LiveKit Cloud
livekit-client ◀═══════════════ WebRTC media (SFU) ══════════════════════════════▶ LiveKit Cloud
                              LiveKit webhooks ──▶ /api/livekit/webhook (signed) ─▶ call state
                              Vercel Cron ──▶ /api/cron/maintenance ─▶ expire calls, delete
                                                                       orphaned/removed files
```

- **Reads** use the user's own session against Postgres; **Row Level Security** decides what is
  visible. Writes that need validation beyond RLS (sending messages, calls, deletions with storage
  cleanup, account deletion, push delivery) go through Route Handlers that verify the session and
  then call `service_role`-only database functions with the verified user id.
- Business rules live in SQL functions (`supabase/migrations/*`), so they are enforced no matter
  which client calls them, and they are covered by the database integration tests.
- Realtime uses Postgres Changes for row updates (RLS-filtered) and **private** Broadcast/Presence
  channels (`conversation:<id>`, `user:<id>`, `online`) authorized by policies on
  `realtime.messages`.

### Data model

All tables have RLS enabled; migrations are in `supabase/migrations/` (applied in filename order).

| Table | Purpose |
| --- | --- |
| `profiles` | username (unique, `a-z0-9_`), display name, avatar path, bio, custom status |
| `user_settings`, `user_last_seen` | privacy (last seen, online, read receipts), notification preferences, quiet hours; last-seen timestamp |
| `app_settings`, `app_admins` | registration mode (`invite`/`open`), administrators |
| `app_invitations`, `app_invitation_uses` | invite codes for registration (expiry, max uses, revocation) |
| `user_blocks`, `user_reports` | blocking; reports with admin review status |
| `conversations` | `direct` (unique per pair via `direct_key`) or `group` (name, description, avatar) |
| `conversation_members` | membership, role (`owner`/`admin`/`member`), shared read/delivered markers |
| `conversation_preferences` | private per-member state: read position, mute, archive, pin, clear, notification level |
| `messages` | text/media/voice/system/call messages; `client_id` for idempotent sends; edit/delete tombstones |
| `attachments` | storage path, name, MIME type (sniffed), size, dimensions/duration, voice waveform |
| `message_reactions`, `message_mentions`, `pinned_messages`, `message_hidden` | reactions, @mentions, pins, "delete for me" |
| `group_invites` | expiring, revocable group invite links |
| `call_sessions`, `call_participants` | call lifecycle (ringing → active → ended with reason) and per-person state |
| `push_subscriptions` | Web Push endpoints per device |
| `private.rate_limits`, `private.storage_deletion_queue` | server-only: rate limiting; files to purge |

Multi-step operations (send with attachments, group membership changes, ownership transfer,
call start/join/leave, account deletion) are single SQL functions, so each runs in one
transaction.

### Repository layout

```
src/app/                 routes: (auth) pages, (app) chats/settings/admin/join, api/* handlers
src/components/chat      conversation list, message list/bubbles, composer, uploads, search …
src/components/calls     call provider (LiveKit), call overlay, incoming-call dialog
src/components/groups    create group, members, invites, group info
src/components/settings  settings sections, admin console
src/components/ui        shadcn/ui-style primitives (Radix + Tailwind)
src/lib/supabase         browser / server / admin (server-only) clients
src/lib/livekit          server-only token + room service helpers
src/lib/security         CSP, origin checks, auth guards, rate limiting
src/lib/validation       Zod schemas shared by forms and API routes
src/hooks, src/types     React hooks; database + domain types
supabase/migrations      schema, RLS, functions, storage, realtime, grants (apply in order)
supabase/templates       auth email templates (token_hash links)
tests/unit               Vitest + Testing Library
tests/integration        RLS / database function tests on a real PostgreSQL
tests/e2e                Playwright: smoke (no backend) and full-stack flows
tests/media              Playwright: real WebRTC media through LiveKit
docs/                    calling test plan
```

## Security model

- **Secrets stay on the server.** Only `NEXT_PUBLIC_*` values reach the browser (Supabase URL,
  publishable key, app URL, VAPID public key). The Supabase secret key, LiveKit API secret, VAPID
  private key and cron secret are read only in `src/lib/env.server.ts`, which imports
  `server-only` so a client import fails the build. `npm run test:smoke` builds with canary
  secret values and scans every emitted client file to prove none leak.
- **Row Level Security on every table.** Members-only access to conversations, messages,
  attachments, reactions and receipts; private per-user state (mute/archive/read position) is
  visible only to its owner; blocked users can't message or call each other. Privileged
  functions live in a non-exposed `private` schema; grants are audited by a test that fails if a
  new function is callable by the wrong role.
- **Storage is private.** Attachments can only be uploaded into a conversation you belong to and
  read by its members; avatars are readable only by people who share a conversation with you.
  Files are served through signed URLs that expire. The server sniffs file contents and rejects
  mismatched or disallowed types.
- **Calls:** LiveKit tokens are minted server-side only, after checking membership, for one room,
  bound to the verified user id, valid 10 minutes, with minimal grants (no room admin). Webhooks
  are signature-verified.
- **Web hardening:** nonce-based Content-Security-Policy, `frame-ancestors 'none'`, HSTS,
  `nosniff`, strict referrer policy, restrictive Permissions-Policy (camera/mic/display-capture
  only for this origin), same-origin + JSON content-type checks on mutating API routes, rate
  limits on message sends, call actions, group admin actions, push registration, account deletion
  and reports, open-redirect protection, no message content or tokens in logs.
- **Encryption:** traffic is encrypted in transit (HTTPS/WSS, DTLS-SRTP for media) and Supabase
  encrypts data at rest. **Messages are not end-to-end encrypted**: the database operator (you,
  and Supabase as your provider) can technically read stored messages and files. LiveKit relays
  call media through its servers; it does not record calls in this app.

## Local development

Requirements: Node.js ≥ 20.9, npm, and either Docker (for the Supabase CLI local stack) or a
free hosted Supabase project.

```bash
npm install
cp .env.example .env.local   # then fill in values (see Configuration)
```

### Option A — local Supabase stack (Docker)

```bash
npx supabase start            # prints API URL, publishable and secret keys
npx supabase db reset         # applies supabase/migrations + seed.sql (open registration)
```

Put the printed URL and keys into `.env.local` (`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`).
Confirmation and reset emails appear in Inbucket at <http://127.0.0.1:54324>.

### Option B — hosted Supabase project

Create a project, then apply the migrations:

```bash
npx supabase link --project-ref <project-ref>
npx supabase db push          # applies supabase/migrations in order
```

(Or paste each file from `supabase/migrations/` into the SQL editor, in filename order.) Then do
the Auth settings from [Deployment](#deployment-vercel--supabase--livekit-cloud) step 3 with
`http://localhost:3000` as the site URL.

### Run

```bash
npm run dev                   # http://localhost:3000
```

Register the first account — it becomes the administrator. Calls need the LiveKit variables; a
free LiveKit Cloud project works for development. Without them, chat works and starting a call
shows "Calling isn't configured on this server yet".

## Configuration

All variables are listed in [`.env.example`](.env.example). Never commit `.env.local`.

| Variable | Where | Required | Purpose |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | public | yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | yes | `sb_publishable_…` (legacy anon key and `NEXT_PUBLIC_SUPABASE_ANON_KEY` accepted) |
| `NEXT_PUBLIC_APP_URL` | public | yes | Canonical app URL; used for email links and the allowed request origin |
| `SUPABASE_SECRET_KEY` | **server** | yes | `sb_secret_…` (legacy `SUPABASE_SERVICE_ROLE_KEY` accepted). Sending, calls, push, deletion, cleanup |
| `LIVEKIT_URL` | **server** | for calls | `wss://<project>.livekit.cloud` |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | **server** | for calls | LiveKit project key pair |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | public | for push | Web Push public key |
| `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | **server** | for push | Web Push private key and `mailto:` contact |
| `CRON_SECRET` | **server** | recommended | Authorizes the daily maintenance job |
| `NEXT_PUBLIC_MAX_ATTACHMENT_MB` | public | no | Per-file limit (default 25, max 50) |

Generate VAPID keys with `npx web-push generate-vapid-keys` and the cron secret with
`openssl rand -hex 32`. `GET /api/health` reports which integrations are configured (booleans only).

## Testing

| Command | What it runs | Needs |
| --- | --- | --- |
| `npm run typecheck` | `tsc --noEmit` (strict) | — |
| `npm run lint` | ESLint (Next.js + React Compiler rules) | — |
| `npm test` | Unit + component tests (Vitest, jsdom) | — |
| `npm run test:integration` | Database tests: every migration on a real PostgreSQL, RLS checked as several different users, privilege audit | `TEST_DATABASE_URL` (PostgreSQL 15+) |
| `npm run test:smoke` | Production build with placeholder config + client bundle secret scan + Playwright smoke tests (routing, auth guards, security headers, PWA, responsive layout) | — |
| `npm run test:e2e` | Full-stack flows between two real users (signup, direct and group chat, replies, reactions, edits, deletes, attachments, blocking, receipts) | Running app + **test** Supabase project |
| `npm run test:media` | Real audio/video/screen-share media between browsers through LiveKit, asserted from WebRTC stats | Running app + test Supabase + LiveKit |

```bash
# Database integration tests (Docker helper starts PostgreSQL on port 54329):
npm run test:db
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npm run test:integration

# Full-stack E2E against a dedicated test project (never production — it creates users):
E2E_BASE_URL=http://localhost:3000 E2E_SUPABASE_URL=… \
E2E_SUPABASE_PUBLISHABLE_KEY=… E2E_SUPABASE_SECRET_KEY=… npm run test:e2e
```

The E2E and media suites **skip with a message** when their services aren't configured, and the
integration suite fails with a clear error if it can't reach PostgreSQL — nothing is reported as
passed without running. The integration suite runs against plain PostgreSQL with a small shim that reproduces
the parts of Supabase the schema depends on (`auth.uid()`, roles, `storage`/`realtime` schemas);
running the same migrations on a real Supabase project (`supabase db reset` / `db push`) is part
of the deployment checklist. Calling is covered by [`docs/calling-test-plan.md`](docs/calling-test-plan.md),
including a manual device matrix.

## Deployment (Vercel + Supabase + LiveKit Cloud)

1. **Create the Supabase project** (choose a region near your users). Keep the database password.
2. **Apply migrations:** `npx supabase link --project-ref <ref>` then `npx supabase db push`.
   Do not run `seed.sql` in production (it opens registration). Before applying future migrations
   to a database with data, take a backup (Database → Backups, or `supabase db dump`).
3. **Auth settings** (Authentication → URL Configuration / Providers / Emails):
   - Site URL: `https://<your-domain>`
   - Redirect URLs: `https://<your-domain>/auth/callback`, `https://<your-domain>/auth/confirm`
     (add `http://localhost:3000/**` for development, and your Vercel preview pattern if needed)
   - Email provider: enabled, "Confirm email" on, minimum password length 8.
   - Email templates: paste the four files from `supabase/templates/` (they use `token_hash`
     links that work on any device).
   - Configure custom SMTP (Authentication → Emails → SMTP). Supabase's built-in sender is
     heavily rate-limited and only meant for testing.
4. **Realtime:** Realtime → Settings → turn off "Allow public access" so only private,
   policy-checked channels are allowed (the app uses private channels exclusively).
5. **Storage:** the migrations create the private `attachments` (50 MB) and `avatars` (5 MB)
   buckets. If your plan's global upload limit is lower than 50 MB, lower
   `NEXT_PUBLIC_MAX_ATTACHMENT_MB` to match.
6. **Keys:** Project Settings → API Keys: copy the publishable key and create a secret key.
7. **LiveKit Cloud:** create a project; copy the WebSocket URL and create an API key/secret.
8. **Vercel:** import the repository, framework "Next.js". Add every variable from the
   [Configuration](#configuration) table for Production (and Preview if you use previews with a
   separate Supabase project). Mark server values as **Sensitive**. Deploy.
9. **LiveKit webhook:** in LiveKit Cloud → Settings → Webhooks add
   `https://<your-domain>/api/livekit/webhook`, signed with the same API key as `LIVEKIT_API_KEY`.
   This keeps call state correct when a browser disappears mid-call.
10. **Cron:** `vercel.json` schedules `/api/cron/maintenance` daily (expires stale calls, deletes
    files of removed messages/avatars, cleans unreferenced uploads). Vercel sends
    `CRON_SECRET` automatically as a bearer token. Hobby plans allow daily cron jobs.
11. **Custom domain** (optional): add it in Vercel, then update Site URL / redirect URLs (step 3)
    and `NEXT_PUBLIC_APP_URL`, and redeploy.
12. **First login:** open the site and register immediately — the first account becomes the
    administrator, and registration then requires an invitation code. Create codes in **Admin**.
13. **Verify:** `https://<your-domain>/api/health` should show `true` for `supabase`, `serverKey`,
    `livekit`, `cron` (and `webPush` if configured). Then run the manual call checks in
    `docs/calling-test-plan.md` on two devices.
14. **Optional automated verification:** point `npm run test:e2e` and `npm run test:media` at a
    staging deployment backed by a separate Supabase project.

### Production checklist

- [ ] Migrations applied in order; `select count(*) from public.app_settings` returns 1
- [ ] `seed.sql` **not** applied; registration mode is `invite` (Admin page)
- [ ] Site URL, redirect URLs and email templates set; custom SMTP configured
- [ ] Realtime "Allow public access" off
- [ ] All server variables set and marked sensitive; no secret in any `NEXT_PUBLIC_*` variable
- [ ] `/api/health` all green
- [ ] LiveKit webhook configured and delivering (LiveKit dashboard shows 200 responses)
- [ ] Cron job visible under Vercel → Settings → Cron Jobs
- [ ] Administrator account created by you
- [ ] Two-device call test (voice, video, screen share) passed
- [ ] Point-in-time recovery / backups enabled on Supabase if the data matters to you

### Backups, monitoring and recovery

- **Backups:** Supabase takes daily backups on paid plans; enable Point-in-Time Recovery if you
  can't afford to lose a day of messages. On the free plan, schedule your own
  `npx supabase db dump --data-only` (and `db dump` for schema) to storage you control. Storage
  files are not included in database backups — use the Storage API or `rclone` to copy the
  `attachments` and `avatars` buckets if you need file backups.
- **Monitoring:** Vercel → Logs / Observability for API errors (logs never contain message
  content or tokens); Supabase → Reports and Logs (Auth, Postgres, Realtime, Storage); LiveKit
  Cloud → Sessions for call quality and webhook delivery. Add an uptime check on `/api/health`.
- **Recovery:** restore the database from a backup or PITR in the Supabase dashboard, then
  redeploy the same Git commit on Vercel. Schema changes only ever go forward through new
  migration files; test them on a staging project (`supabase db push` there first) and take a
  backup before applying to production.
- **Rotating secrets:** create a new Supabase secret key / LiveKit key pair, update Vercel,
  redeploy, then delete the old key (and update the LiveKit webhook signing key).

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| Every page redirects to `/setup` | `NEXT_PUBLIC_SUPABASE_URL` / publishable key missing at **build** time. Set them and redeploy (public variables are baked into the build). |
| "Sending failed" / 503 on send | `SUPABASE_SECRET_KEY` missing on the server. |
| Confirmation link says invalid/expired | Email templates not updated (still PKCE `ConfirmationURL`), Site URL wrong, or link already used. Request a new one. |
| Sign-up says an invitation is required | Expected after the first account. Create an invitation code in Admin, or switch registration to Open. |
| Emails never arrive | Built-in email sender rate limit; configure custom SMTP. |
| Messages don't appear live, banner says "Reconnecting" | Realtime blocked by a proxy/firewall, or the migrations' publication step didn't run. Messages still load on refresh. |
| "Calling isn't configured on this server yet" | `LIVEKIT_*` variables missing on the server. |
| Call connects but no audio/video | Camera/mic permission denied (check the browser's site settings); corporate networks blocking UDP — LiveKit falls back to TURN/TLS on 443, which must not be blocked. |
| Call stays "in progress" after someone closed the tab | LiveKit webhook missing or failing signature check (key mismatch). The daily cron also expires stale calls. |
| Screen share button missing | Not supported on mobile browsers. |
| Push notifications never arrive | VAPID keys missing/mismatched; on iOS, push only works for the app **installed to the Home Screen** (iOS 16.4+). |
| Upload rejected as wrong type | The file's content doesn't match an allowed type (e.g. a renamed executable). |

## Privacy, retention and limitations

- **Deleted messages:** "delete for everyone" replaces the content with a tombstone and removes
  attachments (files are purged by the maintenance job). "Delete for me" only hides the message
  for you. Clearing a chat hides earlier messages for you only.
- **Account deletion** removes your profile data, avatar, uploads, push subscriptions and
  sessions; your messages remain in others' chats as "Deleted account" tombstones without
  content; groups you own are handed to another member (or deleted if empty).
- **Not provided:** end-to-end encryption, malware scanning of uploads (content-type sniffing
  only), call recording, message scheduling, SMS/phone verification.
- **Browser limits:** calls cannot ring natively while the app is closed (a push notification is
  sent instead); screen sharing is desktop-only; speaker selection only in Chromium-based
  browsers.

See [`PROJECT_STATUS.md`](PROJECT_STATUS.md) for verification status and known limitations.
