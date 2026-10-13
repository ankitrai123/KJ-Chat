-- KJ Chat: foundation schema
-- Tables, constraints, indexes and housekeeping triggers.
-- Access control (grants + RLS) lives in 20261013120100_access_control.sql.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- Internal helpers live in a schema that PostgREST does not expose.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ------------------------------------------------------------------ app-wide settings
create table public.app_settings (
  id boolean primary key default true constraint app_settings_singleton check (id),
  registration_mode text not null default 'invite'
    constraint app_settings_registration_mode check (registration_mode in ('open', 'invite')),
  updated_at timestamptz not null default now()
);

insert into public.app_settings (id) values (true) on conflict (id) do nothing;

-- ------------------------------------------------------------------ profiles
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique
    constraint profiles_username_format check (username ~ '^[a-z0-9_]{3,30}$'),
  display_name text not null
    constraint profiles_display_name_length check (char_length(btrim(display_name)) between 1 and 64),
  avatar_path text,
  bio text constraint profiles_bio_length check (char_length(bio) <= 500),
  status_text text constraint profiles_status_length check (char_length(status_text) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Users may only point their avatar at objects inside their own avatar folder.
  constraint profiles_avatar_scope check (
    avatar_path is null or avatar_path ~ ('^users/' || id::text || '/[A-Za-z0-9._-]{1,100}$')
  )
);

create index profiles_username_trgm_idx on public.profiles using gin (username extensions.gin_trgm_ops);
create index profiles_display_name_trgm_idx on public.profiles using gin (display_name extensions.gin_trgm_ops);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

create table public.app_admins (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.user_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  last_seen_visibility text not null default 'everyone'
    constraint user_settings_last_seen check (last_seen_visibility in ('everyone', 'contacts', 'nobody')),
  show_online_status boolean not null default true,
  read_receipts_enabled boolean not null default true,
  notify_messages boolean not null default true,
  notify_calls boolean not null default true,
  notification_previews boolean not null default true,
  notification_sound boolean not null default true,
  quiet_hours_enabled boolean not null default false,
  quiet_hours_start time not null default '22:00',
  quiet_hours_end time not null default '07:00',
  timezone text not null default 'UTC'
    constraint user_settings_timezone_length check (char_length(timezone) between 1 and 64),
  updated_at timestamptz not null default now()
);

create trigger user_settings_set_updated_at
  before update on public.user_settings
  for each row execute function private.set_updated_at();

create table public.user_last_seen (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  last_seen_at timestamptz not null default now()
);

create table public.user_blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_not_self check (blocker_id <> blocked_id)
);

create index user_blocks_blocked_idx on public.user_blocks (blocked_id);

-- ------------------------------------------------------------------ app invitations (invite-only registration)
create table public.app_invitations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  email text constraint app_invitations_email_format check (email is null or position('@' in email) > 1),
  note text constraint app_invitations_note_length check (char_length(note) <= 200),
  created_by uuid references public.profiles (id) on delete set null,
  expires_at timestamptz,
  max_uses integer not null default 1 constraint app_invitations_max_uses check (max_uses between 1 and 100),
  use_count integer not null default 0,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.app_invitation_uses (
  invitation_id uuid not null references public.app_invitations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  used_at timestamptz not null default now(),
  primary key (invitation_id, user_id)
);

-- ------------------------------------------------------------------ conversations
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  type text not null constraint conversations_type check (type in ('direct', 'group')),
  name text constraint conversations_name_length check (name is null or char_length(btrim(name)) between 1 and 100),
  description text constraint conversations_description_length check (description is null or char_length(description) <= 500),
  avatar_path text,
  -- "<smaller uuid>:<larger uuid>" for direct conversations; guarantees one DM per pair.
  direct_key text unique,
  created_by uuid references public.profiles (id) on delete set null,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversations_shape check (
    (type = 'direct' and direct_key is not null and name is null and avatar_path is null)
    or (type = 'group' and direct_key is null and name is not null)
  ),
  constraint conversations_avatar_scope check (
    avatar_path is null or avatar_path ~ ('^groups/' || id::text || '/[A-Za-z0-9._-]{1,100}$')
  )
);

create index conversations_last_message_idx on public.conversations (last_message_at desc);

create trigger conversations_set_updated_at
  before update on public.conversations
  for each row execute function private.set_updated_at();

create table public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' constraint conversation_members_role check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  added_by uuid references public.profiles (id) on delete set null,
  -- Public receipts, visible to other members. Only advanced when the member allows read receipts.
  last_read_at timestamptz,
  last_delivered_at timestamptz,
  primary key (conversation_id, user_id)
);

create index conversation_members_user_idx on public.conversation_members (user_id);
create unique index conversation_members_single_owner_idx on public.conversation_members (conversation_id) where role = 'owner';

-- Private per-member state; only ever visible to its owner.
create table public.conversation_preferences (
  conversation_id uuid not null,
  user_id uuid not null,
  last_read_at timestamptz,
  muted_until timestamptz,
  archived_at timestamptz,
  pinned_at timestamptz,
  cleared_at timestamptz,
  notification_level text not null default 'all'
    constraint conversation_preferences_level check (notification_level in ('all', 'mentions', 'none')),
  primary key (conversation_id, user_id),
  foreign key (conversation_id, user_id)
    references public.conversation_members (conversation_id, user_id) on delete cascade
);

create index conversation_preferences_user_idx on public.conversation_preferences (user_id);

create or replace function private.create_member_preferences()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.conversation_preferences (conversation_id, user_id, last_read_at)
  values (new.conversation_id, new.user_id, now())
  on conflict (conversation_id, user_id) do nothing;
  return new;
end;
$$;

create trigger conversation_members_create_preferences
  after insert on public.conversation_members
  for each row execute function private.create_member_preferences();

-- ------------------------------------------------------------------ messages
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid references public.profiles (id) on delete set null,
  -- Client-generated id used for idempotent sends and optimistic UI reconciliation.
  client_id uuid,
  message_type text not null default 'text'
    constraint messages_type check (message_type in ('text', 'image', 'video', 'audio', 'voice', 'file', 'system', 'call')),
  content text constraint messages_content_length check (char_length(content) <= 4000),
  metadata jsonb not null default '{}'::jsonb,
  reply_to_message_id uuid references public.messages (id) on delete set null,
  is_forwarded boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  edited_at timestamptz,
  deleted_at timestamptz,
  constraint messages_sender_client_unique unique (sender_id, client_id)
);

create index messages_conversation_created_idx on public.messages (conversation_id, created_at desc, id desc);
create index messages_sender_idx on public.messages (sender_id);
create index messages_reply_to_idx on public.messages (reply_to_message_id) where reply_to_message_id is not null;
create index messages_content_trgm_idx on public.messages using gin (content extensions.gin_trgm_ops) where deleted_at is null;

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  uploader_id uuid references public.profiles (id) on delete set null,
  storage_path text not null unique,
  file_name text not null constraint attachments_file_name_length check (char_length(file_name) between 1 and 255),
  mime_type text not null constraint attachments_mime_length check (char_length(mime_type) between 3 and 127),
  file_size bigint not null constraint attachments_file_size check (file_size > 0),
  kind text not null constraint attachments_kind check (kind in ('image', 'video', 'audio', 'voice', 'file')),
  width integer constraint attachments_width check (width between 1 and 20000),
  height integer constraint attachments_height check (height between 1 and 20000),
  duration_ms integer constraint attachments_duration check (duration_ms between 0 and 86400000),
  waveform jsonb,
  created_at timestamptz not null default now()
);

create index attachments_message_idx on public.attachments (message_id);
create index attachments_conversation_idx on public.attachments (conversation_id, created_at desc);
create index attachments_uploader_idx on public.attachments (uploader_id);

create table public.message_reactions (
  -- Surrogate key so realtime delete notifications never expose who reacted.
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  emoji text not null constraint message_reactions_emoji check (emoji ~ '^\S{1,16}$'),
  created_at timestamptz not null default now(),
  constraint message_reactions_unique unique (message_id, user_id, emoji)
);

create index message_reactions_conversation_idx on public.message_reactions (conversation_id);

-- "Delete for me"
create table public.message_hidden (
  user_id uuid not null references public.profiles (id) on delete cascade,
  message_id uuid not null references public.messages (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, message_id)
);

create index message_hidden_message_idx on public.message_hidden (message_id);

create table public.message_mentions (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  primary key (message_id, user_id)
);

create index message_mentions_user_idx on public.message_mentions (user_id, conversation_id);

create table public.pinned_messages (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  message_id uuid not null references public.messages (id) on delete cascade,
  pinned_by uuid references public.profiles (id) on delete set null,
  pinned_at timestamptz not null default now(),
  primary key (conversation_id, message_id)
);

-- ------------------------------------------------------------------ moderation
create table public.user_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reported_user_id uuid references public.profiles (id) on delete set null,
  message_id uuid references public.messages (id) on delete set null,
  reason text not null
    constraint user_reports_reason check (reason in ('spam', 'harassment', 'inappropriate', 'impersonation', 'other')),
  details text constraint user_reports_details_length check (char_length(details) <= 1000),
  status text not null default 'open' constraint user_reports_status check (status in ('open', 'reviewed', 'dismissed')),
  created_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz
);

create index user_reports_status_idx on public.user_reports (status, created_at desc);
create index user_reports_reporter_idx on public.user_reports (reporter_id);

-- ------------------------------------------------------------------ group invitation links
create table public.group_invites (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  created_by uuid references public.profiles (id) on delete set null,
  expires_at timestamptz not null,
  max_uses integer constraint group_invites_max_uses check (max_uses is null or max_uses between 1 and 1000),
  use_count integer not null default 0,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index group_invites_conversation_idx on public.group_invites (conversation_id);

-- ------------------------------------------------------------------ calls
create table public.call_sessions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  room_name text not null unique,
  media_type text not null constraint call_sessions_media_type check (media_type in ('audio', 'video')),
  started_by uuid references public.profiles (id) on delete set null,
  status text not null default 'ringing' constraint call_sessions_status check (status in ('ringing', 'active', 'ended')),
  end_reason text constraint call_sessions_end_reason check (
    end_reason is null or end_reason in ('completed', 'missed', 'declined', 'cancelled', 'busy', 'failed')
  ),
  created_at timestamptz not null default now(),
  ring_expires_at timestamptz not null default now() + interval '45 seconds',
  answered_at timestamptz,
  ended_at timestamptz,
  constraint call_sessions_end_shape check ((status = 'ended') = (ended_at is not null))
);

-- At most one live call per conversation.
create unique index call_sessions_one_live_idx on public.call_sessions (conversation_id) where status <> 'ended';
create index call_sessions_status_idx on public.call_sessions (status, ring_expires_at);

create table public.call_participants (
  call_id uuid not null references public.call_sessions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  status text not null constraint call_participants_status check (
    status in ('invited', 'joined', 'left', 'declined', 'missed', 'busy')
  ),
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  left_at timestamptz,
  primary key (call_id, user_id)
);

create index call_participants_user_idx on public.call_participants (user_id, status);
create index call_participants_conversation_idx on public.call_participants (conversation_id);

-- ------------------------------------------------------------------ web push
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique
    constraint push_subscriptions_endpoint check (endpoint ~ '^https://' and char_length(endpoint) <= 2048),
  p256dh text not null constraint push_subscriptions_p256dh check (char_length(p256dh) between 16 and 256),
  auth text not null constraint push_subscriptions_auth check (char_length(auth) between 8 and 128),
  user_agent text constraint push_subscriptions_ua check (char_length(user_agent) <= 512),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  failure_count integer not null default 0
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- ------------------------------------------------------------------ internal tables (not exposed)
create table private.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  count integer not null
);

-- Storage objects whose database rows were removed; deleted asynchronously by the server.
create table private.storage_deletion_queue (
  id bigint generated always as identity primary key,
  bucket_id text not null,
  path text not null,
  enqueued_at timestamptz not null default now(),
  attempts integer not null default 0
);

create or replace function private.enqueue_attachment_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.storage_deletion_queue (bucket_id, path) values ('attachments', old.storage_path);
  return old;
end;
$$;

create trigger attachments_enqueue_storage_deletion
  after delete on public.attachments
  for each row execute function private.enqueue_attachment_deletion();

create or replace function private.enqueue_avatar_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.avatar_path is not null and (tg_op = 'DELETE' or new.avatar_path is distinct from old.avatar_path) then
    insert into private.storage_deletion_queue (bucket_id, path) values ('avatars', old.avatar_path);
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger profiles_enqueue_avatar_deletion
  after update of avatar_path or delete on public.profiles
  for each row execute function private.enqueue_avatar_deletion();

create trigger conversations_enqueue_avatar_deletion
  after update of avatar_path or delete on public.conversations
  for each row execute function private.enqueue_avatar_deletion();
