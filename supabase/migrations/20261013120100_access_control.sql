-- KJ Chat: access control
-- Helper predicates, signup trigger, table grants and row level security policies.
--
-- Model: authenticated users get SELECT on most tables, gated by RLS. Writes that touch
-- shared state go through SECURITY DEFINER functions (later migrations) that derive the
-- acting user from auth.uid() and validate every rule. Direct writes are only granted
-- where the row is purely the caller's own (profile fields, settings, blocks, ...).

-- ------------------------------------------------------------------ helper predicates
create or replace function private.try_uuid(p_value text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p_value::uuid;
exception
  when others then
    return null;
end;
$$;

create or replace function private.is_member(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.conversation_members m
    where m.conversation_id = p_conversation_id
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function private.is_user_member(p_conversation_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.conversation_members m
    where m.conversation_id = p_conversation_id
      and m.user_id = p_user_id
  );
$$;

create or replace function private.member_role(p_conversation_id uuid, p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.conversation_members m
  where m.conversation_id = p_conversation_id
    and m.user_id = p_user_id;
$$;

create or replace function private.is_group_admin(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.conversation_members m
    join public.conversations c on c.id = m.conversation_id
    where m.conversation_id = p_conversation_id
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
      and c.type = 'group'
  );
$$;

create or replace function private.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.app_admins a where a.user_id = (select auth.uid()));
$$;

create or replace function private.is_blocked_between(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_blocks b
    where (b.blocker_id = p_a and b.blocked_id = p_b)
       or (b.blocker_id = p_b and b.blocked_id = p_a)
  );
$$;

create or replace function private.shares_conversation(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.conversation_members m1
    join public.conversation_members m2 on m2.conversation_id = m1.conversation_id
    where m1.user_id = p_a
      and m2.user_id = p_b
  );
$$;

create or replace function private.can_see_last_seen(p_target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) is null then false
    when p_target = (select auth.uid()) then true
    when private.is_blocked_between(p_target, (select auth.uid())) then false
    else coalesce((
      select case s.last_seen_visibility
        when 'everyone' then true
        when 'contacts' then private.shares_conversation(p_target, (select auth.uid()))
        else false
      end
      from public.user_settings s
      where s.user_id = p_target
    ), false)
  end;
$$;

create or replace function private.direct_peer(p_conversation_id uuid, p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id
  from public.conversation_members m
  where m.conversation_id = p_conversation_id
    and m.user_id <> p_user_id
  limit 1;
$$;

-- ------------------------------------------------------------------ signup trigger
-- Creates the profile and enforces invite-only registration at the database layer, so the
-- rule holds even if someone calls the Auth API directly with the publishable key.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text;
  v_is_first boolean;
  v_code text := nullif(btrim(new.raw_user_meta_data ->> 'invite_code'), '');
  v_display_name text := left(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), 64);
  v_invite public.app_invitations%rowtype;
  v_admin_created boolean := coalesce((new.raw_app_meta_data ->> 'kj_admin_created')::boolean, false);
begin
  -- Serialise registrations so "first user becomes admin" and invite use counts are exact.
  perform pg_advisory_xact_lock(hashtext('kj_chat_registration'));

  select s.registration_mode into v_mode from public.app_settings s where s.id;
  select not exists (select 1 from public.profiles) into v_is_first;

  if coalesce(v_mode, 'invite') = 'invite' and not v_is_first and not v_admin_created then
    if v_code is null then
      raise exception 'Registration is invite-only. An invitation code is required.'
        using errcode = 'P0001', hint = 'invite_required';
    end if;

    select * into v_invite
    from public.app_invitations i
    where i.code = v_code
    for update;

    if not found
      or v_invite.revoked_at is not null
      or (v_invite.expires_at is not null and v_invite.expires_at <= now())
      or v_invite.use_count >= v_invite.max_uses
      or (v_invite.email is not null and lower(v_invite.email) <> lower(coalesce(new.email, ''))) then
      raise exception 'This invitation code is invalid, expired or already used.'
        using errcode = 'P0001', hint = 'invite_invalid';
    end if;

    update public.app_invitations set use_count = use_count + 1 where id = v_invite.id;
  end if;

  insert into public.profiles (id, display_name)
  values (new.id, coalesce(v_display_name, left(split_part(coalesce(new.email, 'user'), '@', 1), 64), 'user'));

  insert into public.user_settings (user_id) values (new.id);
  insert into public.user_last_seen (user_id) values (new.id);

  if v_invite.id is not null then
    insert into public.app_invitation_uses (invitation_id, user_id) values (v_invite.id, new.id);
  end if;

  if v_is_first then
    insert into public.app_admins (user_id) values (new.id);
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ------------------------------------------------------------------ function privileges (private)
revoke all on all functions in schema private from public;
grant execute on function
  private.try_uuid(text),
  private.is_member(uuid),
  private.is_group_admin(uuid),
  private.is_app_admin(),
  private.can_see_last_seen(uuid)
to authenticated, service_role;

-- ------------------------------------------------------------------ row level security
alter table public.app_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.app_admins enable row level security;
alter table public.user_settings enable row level security;
alter table public.user_last_seen enable row level security;
alter table public.user_blocks enable row level security;
alter table public.app_invitations enable row level security;
alter table public.app_invitation_uses enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.conversation_preferences enable row level security;
alter table public.messages enable row level security;
alter table public.attachments enable row level security;
alter table public.message_reactions enable row level security;
alter table public.message_hidden enable row level security;
alter table public.message_mentions enable row level security;
alter table public.pinned_messages enable row level security;
alter table public.user_reports enable row level security;
alter table public.group_invites enable row level security;
alter table public.call_sessions enable row level security;
alter table public.call_participants enable row level security;
alter table public.push_subscriptions enable row level security;

-- Start from zero; Supabase grants ALL on new tables to anon/authenticated by default.
revoke all on all tables in schema public from anon, authenticated;

grant select on public.app_settings to authenticated;
grant select on public.profiles to authenticated;
grant update (username, display_name, avatar_path, bio, status_text) on public.profiles to authenticated;
grant select on public.app_admins to authenticated;
grant select on public.user_settings to authenticated;
grant update (
  last_seen_visibility, show_online_status, read_receipts_enabled, notify_messages, notify_calls,
  notification_previews, notification_sound, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, timezone
) on public.user_settings to authenticated;
grant select on public.user_last_seen to authenticated;
grant select, insert, delete on public.user_blocks to authenticated;
grant select on public.app_invitations, public.app_invitation_uses to authenticated;
grant select on public.conversations to authenticated;
grant select on public.conversation_members to authenticated;
grant select on public.conversation_preferences to authenticated;
grant update (muted_until, archived_at, pinned_at, notification_level) on public.conversation_preferences to authenticated;
grant select on public.messages, public.attachments, public.message_reactions, public.pinned_messages to authenticated;
grant select, insert, delete on public.message_hidden to authenticated;
grant select on public.message_mentions to authenticated;
grant select on public.user_reports to authenticated;
grant select on public.group_invites to authenticated;
grant select on public.call_sessions, public.call_participants to authenticated;
grant select, delete on public.push_subscriptions to authenticated;

-- app_settings
create policy "app settings readable by signed-in users"
  on public.app_settings for select to authenticated
  using (true);

-- profiles
create policy "profiles readable by signed-in users"
  on public.profiles for select to authenticated
  using (true);

create policy "users update their own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- app_admins
create policy "admins visible to themselves and other admins"
  on public.app_admins for select to authenticated
  using (user_id = (select auth.uid()) or private.is_app_admin());

-- user_settings
create policy "users read their own settings"
  on public.user_settings for select to authenticated
  using (user_id = (select auth.uid()));

create policy "users update their own settings"
  on public.user_settings for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- user_last_seen
create policy "last seen respects privacy settings"
  on public.user_last_seen for select to authenticated
  using (private.can_see_last_seen(user_id));

-- user_blocks
create policy "users see their own blocks"
  on public.user_blocks for select to authenticated
  using (blocker_id = (select auth.uid()));

create policy "users block others"
  on public.user_blocks for insert to authenticated
  with check (blocker_id = (select auth.uid()) and blocked_id <> (select auth.uid()));

create policy "users unblock others"
  on public.user_blocks for delete to authenticated
  using (blocker_id = (select auth.uid()));

-- app invitations (admin only)
create policy "app admins read invitations"
  on public.app_invitations for select to authenticated
  using (private.is_app_admin());

create policy "app admins read invitation uses"
  on public.app_invitation_uses for select to authenticated
  using (private.is_app_admin());

-- conversations and membership
create policy "members read their conversations"
  on public.conversations for select to authenticated
  using (private.is_member(id));

create policy "members read co-members"
  on public.conversation_members for select to authenticated
  using (private.is_member(conversation_id));

create policy "users read their own conversation preferences"
  on public.conversation_preferences for select to authenticated
  using (user_id = (select auth.uid()));

create policy "users update their own conversation preferences"
  on public.conversation_preferences for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- messages and related
create policy "members read messages"
  on public.messages for select to authenticated
  using (private.is_member(conversation_id));

create policy "members read attachments"
  on public.attachments for select to authenticated
  using (private.is_member(conversation_id));

create policy "members read reactions"
  on public.message_reactions for select to authenticated
  using (private.is_member(conversation_id));

create policy "members read pinned messages"
  on public.pinned_messages for select to authenticated
  using (private.is_member(conversation_id));

create policy "users read their own mentions"
  on public.message_mentions for select to authenticated
  using (user_id = (select auth.uid()) and private.is_member(conversation_id));

create policy "users read their hidden messages"
  on public.message_hidden for select to authenticated
  using (user_id = (select auth.uid()));

create policy "users hide messages they can read"
  on public.message_hidden for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.messages m
      where m.id = message_id and private.is_member(m.conversation_id)
    )
  );

create policy "users unhide their messages"
  on public.message_hidden for delete to authenticated
  using (user_id = (select auth.uid()));

-- reports
create policy "reporters and app admins read reports"
  on public.user_reports for select to authenticated
  using (reporter_id = (select auth.uid()) or private.is_app_admin());

-- group invites
create policy "group admins read invite links"
  on public.group_invites for select to authenticated
  using (private.is_group_admin(conversation_id));

-- calls
create policy "members read call sessions"
  on public.call_sessions for select to authenticated
  using (private.is_member(conversation_id));

create policy "members read call participants"
  on public.call_participants for select to authenticated
  using (private.is_member(conversation_id));

-- push subscriptions
create policy "users read their push subscriptions"
  on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));

create policy "users delete their push subscriptions"
  on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));
