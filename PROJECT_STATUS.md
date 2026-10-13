# Project status

_Last updated: 2026-10-13._

**Summary:** all six phases are implemented and pass every check that can run without live
services (typecheck, lint, 109 unit tests, 80 database/RLS tests, production build, client
bundle secret scan, 22 browser smoke tests). **Nothing has run yet against a real Supabase
project or LiveKit Cloud**, because no credentials were available in the build environment. Real
messaging between users, real calls, screen sharing, push and email delivery are implemented but
**unverified** until the steps under [Exact next steps](#exact-next-steps) are done. They are
labelled that way below.

Status labels:

- **Verified** — implemented and covered by automated tests that ran and passed here.
- **Implemented, unverified live** — code complete, unit/DB-level parts tested, but the end-to-end
  path needs Supabase/LiveKit credentials (the E2E/media tests for it exist and are skipped).
- **Not implemented** — deliberately out of scope or remaining work.

## Definition of Done

| Requirement | Status | Evidence / what's missing |
| --- | --- | --- |
| Multiple approved users can sign in | Implemented, unverified live | Invite-only signup, first-admin and invite-code rules verified in DB tests; Supabase Auth email/password flow not run against a real project (E2E #1–2 skipped) |
| Private messages work in real time and persist | Implemented, unverified live | Sending, idempotency, ordering, receipts, unread counts, edit/delete verified in DB tests; live Realtime delivery needs a project (E2E #3–7, #12 skipped) |
| Group conversations with correct permissions | **Verified** (database layer) | Roles, add/remove, ownership transfer, invite links, leave/delete tested with several users; UI permission rules unit-tested |
| Files uploaded and shared privately | **Verified** (database/policy layer); upload UI unverified live | Storage policies tested as members, non-members and removed members; content sniffing unit-tested; real Storage upload/signed URLs need a project (E2E #10 skipped) |
| Voice messages recorded and played | Implemented, unverified live | Recorder (pause/resume/cancel/preview), player (seek, 1×/1.5×/2×, waveform). Format chosen at runtime from WebM/Opus, MP4/AAC, Ogg/Opus; **not yet verified on Safari/iOS devices** |
| Real audio calls between separate devices | **Implemented, unverified** | Server token/authorization logic verified (DB + unit); `tests/media` real-media test written, skipped (no LiveKit); manual device matrix not run |
| Real video calls between separate devices | **Implemented, unverified** | As above |
| Screen sharing on supported browsers | **Implemented, unverified** | As above (desktop only by browser design) |
| Group calls through LiveKit | **Implemented, unverified** | As above |
| Users can't access others' conversations/files | **Verified** (database layer) | RLS + storage + realtime-topic policies tested with independent users; privilege audit test fails on any wrongly-granted function |
| Core tests pass | **Verified** | See [Tests](#tests) |
| Production build succeeds | **Verified** | `npm run test:smoke` builds and serves the production bundle |
| Deployment instructions complete | Done | README → Deployment, checklist, backups/monitoring, troubleshooting |
| External setup documented | Done | README → Configuration, `.env.example`, [Missing credentials](#missing-credentials) |

## Completed features

**Phase 1 — Foundation:** Next.js 16 App Router + React 19 + strict TypeScript; Tailwind v4 +
shadcn-style Radix components, Lucide, light/dark/system theme; Supabase browser/server/admin
clients (`@supabase/ssr`); request proxy with session refresh, route protection and per-request
CSP nonce; 9 ordered migrations (24 tables, RLS on all, functions in a non-exposed `private`
schema); email/password registration with confirmation, login, logout (this device/everywhere),
password reset, onboarding (username, display name, avatar), profile editing (bio, custom status),
invite-only registration with admin-managed codes, first user becomes admin.

**Phase 2 — Messaging:** direct chats (deduplicated per pair), server-validated idempotent sends,
optimistic pending/sent/failed states with retry, failed text kept across reloads, drafts per
chat, realtime inserts/edits/deletes/reactions/receipts with duplicate-event handling and
reconnect catch-up, cursor pagination, unread separator and badges, delivered/read receipts
(respecting privacy settings), typing indicators, presence and last seen, replies with quoted
previews, reactions, edit (48 h), delete for me / everyone, forward, pin, copy, message info,
per-chat search and global search, jump-to-message, mute/archive/pin/clear chat, conversation
filters.

**Phase 3 — Groups and attachments:** create/edit groups (name, photo, description), roles
(owner/admin/member), add/remove members, promote/demote, transfer ownership, leave, delete,
expiring/revocable invite links with server-side validation, @mentions, per-group notification
level; private attachment bucket with membership-scoped policies, server-side MIME sniffing,
images (lightbox), video, audio, PDF/office documents, upload progress/cancel/retry,
drag-and-drop and paste, shared media/files tab, voice notes.

**Phase 4 — Calling:** LiveKit integration with server-minted 10-minute tokens (one room,
verified identity, minimal grants), 1:1 and group voice/video calls, ringing/incoming/connecting/
connected/reconnecting/ended states, accept/decline/cancel, busy and 45 s missed-call handling,
join an ongoing group call, mic/camera toggles and device selection, permission-denied and
missing-device handling, screen sharing with indicator and browser-stop handling, grid/focus
layouts with active speaker, full screen, picture-in-picture, host mute/remove, call log
messages, signed LiveKit webhooks for crash-safe call state.

**Phase 5 — Notifications and polish:** in-app toasts, browser notifications, incoming-call alert
and ringtone, Web Push (VAPID) with subscription cleanup, per-chat mute, quiet hours, preview
privacy, sound preference; installable PWA (manifest, icons, service worker, offline page);
settings (profile, privacy, notifications, blocked users, appearance, account: password change,
sign out everywhere, deletion); admin
console (registration mode, invitation codes, reports, admins); blocking and reporting;
responsive one-pane mobile layout with safe areas; skeletons, empty and error states;
confirmation dialogs; keyboard and screen-reader labels.

**Phase 6 — Production readiness:** security headers + CSP, origin/content-type checks,
DB-backed rate limits, daily maintenance cron (stale calls, storage cleanup), health endpoint,
test suites below, README (setup, architecture, data model, configuration, testing,
deployment, checklist, operations, troubleshooting), calling test plan.

## In progress

Nothing is mid-implementation. The remaining work is verification against live services (below).

## Remaining features / not implemented

- End-to-end encryption (not provided; documented).
- Malware scanning / quarantine of uploads (content-type sniffing only; documented).
- Saved/starred messages, message scheduling, polls, link previews, disappearing messages,
  OAuth/social login, two-factor authentication, call recording, background blur/noise
  suppression — not in scope for this version.
- Native-style ringing while the app is closed (impossible for web apps; push notification is
  the fallback).

## Tests

Run on 2026-10-13 in the build container (Node 22, Chromium 141 via Playwright 1.56.1,
PostgreSQL 16.15).

| Suite | Command | Result |
| --- | --- | --- |
| Type check | `npm run typecheck` | **Pass** (0 errors) |
| Lint | `npm run lint` | **Pass** (0 errors, 0 warnings) |
| Unit + component | `npm test` | **109 passed**, 0 failed (13 files) |
| Database integration (RLS, functions, storage policies, realtime topics, privilege audit) | `npm run test:integration` | **80 passed**, 0 failed (7 files) |
| Production build + bundle secret scan + smoke | `npm run test:smoke` | Build OK; **47 client files, no server secrets**; **22 passed**, 0 failed; no console errors or CSP violations |
| Full-stack E2E (14 scenarios from the brief, 12 tests) | `npm run test:e2e` | **12 skipped** — no test Supabase project |
| Real-media calls (1:1 + screen share, group, token authorization) | `npm run test:media` | **3 skipped** — no Supabase/LiveKit |
| Manual device matrix (`docs/calling-test-plan.md` M1–M12) | — | **Not run** — needs physical devices |

Failed tests: **none**. Skipped tests are skipped because the services they need aren't
configured; they are not counted as passing.

About the database tests: they run every migration on plain PostgreSQL with a shim that
reproduces the Supabase pieces the schema relies on (`auth.uid()`, the `anon`/`authenticated`/
`service_role` roles, `storage` and `realtime` schemas, `realtime.send`). Queries run exactly as
PostgREST would run them for each user. The shim is close but not identical to Supabase, so the
first `supabase db push` / `supabase db reset` on a real stack is itself a verification step.

## Missing credentials

| Needed for | Values | Where to get them |
| --- | --- | --- |
| Everything | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | Supabase → Project Settings → API Keys |
| Calls | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, plus webhook to `/api/livekit/webhook` | LiveKit Cloud → Settings → Keys / Webhooks |
| Production email | Custom SMTP credentials | Your email provider → Supabase → Authentication → Emails → SMTP |
| Push (optional) | `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | `npx web-push generate-vapid-keys` |
| Maintenance cron | `CRON_SECRET` | `openssl rand -hex 32` |
| Automated E2E/media tests | `E2E_BASE_URL`, `E2E_SUPABASE_URL`, `E2E_SUPABASE_PUBLISHABLE_KEY`, `E2E_SUPABASE_SECRET_KEY` | A **separate** test Supabase project |

## Known limitations

- **Not end-to-end encrypted.** Encrypted in transit and at rest by the providers; the database
  operator can read stored content.
- **Unverified against live services** (see above): realtime delivery, Storage uploads/signed
  URLs, email links, push delivery, LiveKit media.
- `src/types/database.ts` is hand-written to match the migrations because the Supabase CLI local
  stack couldn't run here (container images couldn't be pulled). Run `npm run db:types` against
  a local stack and diff it with the hand-written file.
- Orphaned-upload cleanup (`list_orphan_uploads`) reads `storage.objects` as the function owner.
  If that role can't bypass RLS on your project, the query returns nothing and orphans simply
  aren't cleaned (fails safe). Check with
  `select * from public.list_orphan_uploads(0, 5);` in the SQL editor after uploading a file.
- Rate limiting fails open if the limiter's database call errors (so outages don't lock users out).
- Groups are capped at 256 members; edits allowed for 48 hours; messages up to 4,000 characters;
  files up to 25 MB by default (50 MB max).
- Web limitations: no ringing while the app is closed (push only, best-effort); iOS push needs
  the app installed to the Home Screen (iOS 16.4+); screen sharing desktop only; speaker
  selection Chromium-only; picture-in-picture shows one stream.
- Voice-note recording format depends on the browser (WebM/Opus on Chromium/Firefox, MP4/AAC on
  Safari); cross-browser playback of each format has not been verified on real devices.
- No virus scanning of uploads.

## Exact next steps

1. **Supabase project:** create it, then `npx supabase link --project-ref <ref>` and
   `npx supabase db push`. Confirm all 9 migrations apply cleanly (first run on real Supabase).
2. Apply the Auth settings, email templates, SMTP and Realtime "Allow public access: off" from
   README → Deployment steps 3–6.
3. **LiveKit Cloud:** create a project and key pair; add the webhook URL after deploying.
4. **Vercel:** import the repo, add the variables from `.env.example`, deploy; check
   `/api/health` shows `true` for `supabase`, `serverKey`, `livekit`, `cron`.
5. Register your account first (becomes admin), create invitation codes for your contacts.
6. **Automated verification** against a separate test project:
   `npm run test:e2e` then `npm run test:media` (see README → Testing). Record results here.
7. **Manual call checks** M1–M12 from `docs/calling-test-plan.md` on two devices on different
   networks. Record browser/OS versions and results here.
8. Regenerate database types (`npm run db:types`) on a local stack and reconcile with
   `src/types/database.ts`.
9. Enable backups / PITR and an uptime check on `/api/health` (README → Backups, monitoring and
   recovery).
