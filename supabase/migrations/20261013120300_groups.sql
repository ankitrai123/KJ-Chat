-- KJ Chat: group conversations, roles and invitation links
--
-- Role rules:
--   owner  - exactly one per group; may do everything, including deleting the group,
--            transferring ownership and demoting admins.
--   admin  - may edit group info, add/remove members (not the owner or other admins),
--            promote members to admin, manage invite links, pin messages.
--   member - may read, send, leave.

create or replace function private.require_group_role(p_conversation_id uuid, p_user_id uuid, p_roles text[])
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  select m.role into v_role
  from public.conversation_members m
  join public.conversations c on c.id = m.conversation_id
  where m.conversation_id = p_conversation_id
    and m.user_id = p_user_id
    and c.type = 'group';

  if v_role is null then
    raise exception 'Group not found.' using errcode = 'P0002';
  end if;

  if not (v_role = any (p_roles)) then
    raise exception 'You do not have permission to do that in this group.' using errcode = '42501';
  end if;

  return v_role;
end;
$$;

create or replace function private.group_member_limit()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 256;
$$;

create or replace function public.create_group(
  p_name text,
  p_description text default null,
  p_member_ids uuid[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid;
  v_added uuid[];
begin
  if char_length(v_name) < 1 or char_length(v_name) > 100 then
    raise exception 'Group name must be between 1 and 100 characters.' using errcode = '22023';
  end if;

  if coalesce(array_length(p_member_ids, 1), 0) >= private.group_member_limit() then
    raise exception 'Too many members.' using errcode = '22023';
  end if;

  insert into public.conversations (type, name, description, created_by)
  values ('group', v_name, nullif(btrim(coalesce(p_description, '')), ''), v_uid)
  returning id into v_id;

  insert into public.conversation_members (conversation_id, user_id, role, added_by)
  values (v_id, v_uid, 'owner', v_uid);

  -- Users who blocked (or were blocked by) the creator are silently skipped.
  with candidates as (
    select distinct p.id
    from unnest(coalesce(p_member_ids, '{}')) as u(id)
    join public.profiles p on p.id = u.id
    where p.id <> v_uid
      and not private.is_blocked_between(v_uid, p.id)
  ), inserted as (
    insert into public.conversation_members (conversation_id, user_id, role, added_by)
    select v_id, c.id, 'member', v_uid from candidates c
    returning user_id
  )
  select coalesce(array_agg(user_id), '{}') into v_added from inserted;

  perform private.insert_system_message(
    v_id, v_uid, 'group_created',
    jsonb_build_object('name', v_name, 'user_ids', to_jsonb(v_added))
  );

  return v_id;
end;
$$;

create or replace function public.update_group(p_conversation_id uuid, p_name text, p_description text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_name text := btrim(coalesce(p_name, ''));
  v_old_name text;
begin
  perform private.require_group_role(p_conversation_id, v_uid, array['owner', 'admin']);

  if char_length(v_name) < 1 or char_length(v_name) > 100 then
    raise exception 'Group name must be between 1 and 100 characters.' using errcode = '22023';
  end if;

  select c.name into v_old_name from public.conversations c where c.id = p_conversation_id;

  update public.conversations
  set name = v_name,
      description = nullif(btrim(coalesce(p_description, '')), '')
  where id = p_conversation_id;

  if v_old_name is distinct from v_name then
    perform private.insert_system_message(
      p_conversation_id, v_uid, 'group_renamed',
      jsonb_build_object('name', v_name, 'previous_name', v_old_name)
    );
  end if;
end;
$$;

create or replace function public.set_group_avatar(p_conversation_id uuid, p_avatar_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
begin
  perform private.require_group_role(p_conversation_id, v_uid, array['owner', 'admin']);

  -- The table's check constraint restricts the path to this group's avatar folder.
  update public.conversations
  set avatar_path = nullif(btrim(coalesce(p_avatar_path, '')), '')
  where id = p_conversation_id;
end;
$$;

create or replace function public.add_group_members(p_conversation_id uuid, p_user_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_added uuid[];
  v_current integer;
begin
  perform private.require_group_role(p_conversation_id, v_uid, array['owner', 'admin']);

  select count(*) into v_current from public.conversation_members m where m.conversation_id = p_conversation_id;
  if v_current + coalesce(array_length(p_user_ids, 1), 0) > private.group_member_limit() then
    raise exception 'This group is full.' using errcode = 'P0001', hint = 'group_full';
  end if;

  with candidates as (
    select distinct p.id
    from unnest(coalesce(p_user_ids, '{}')) as u(id)
    join public.profiles p on p.id = u.id
    where not private.is_blocked_between(v_uid, p.id)
      and not exists (
        select 1 from public.conversation_members m
        where m.conversation_id = p_conversation_id and m.user_id = p.id
      )
  ), inserted as (
    insert into public.conversation_members (conversation_id, user_id, role, added_by)
    select p_conversation_id, c.id, 'member', v_uid from candidates c
    returning user_id
  )
  select coalesce(array_agg(user_id), '{}') into v_added from inserted;

  if coalesce(array_length(v_added, 1), 0) > 0 then
    perform private.insert_system_message(
      p_conversation_id, v_uid, 'members_added', jsonb_build_object('user_ids', to_jsonb(v_added))
    );
  end if;

  return coalesce(array_length(v_added, 1), 0);
end;
$$;

create or replace function public.remove_group_member(p_conversation_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_actor_role text;
  v_target_role text;
begin
  v_actor_role := private.require_group_role(p_conversation_id, v_uid, array['owner', 'admin']);

  if p_user_id = v_uid then
    raise exception 'Use "Leave group" to remove yourself.' using errcode = '22023';
  end if;

  v_target_role := private.member_role(p_conversation_id, p_user_id);
  if v_target_role is null then
    raise exception 'That person is not in this group.' using errcode = 'P0002';
  end if;

  if v_target_role = 'owner' or (v_target_role = 'admin' and v_actor_role <> 'owner') then
    raise exception 'You cannot remove this member.' using errcode = '42501';
  end if;

  update public.call_participants
  set status = 'left', left_at = now()
  where user_id = p_user_id and conversation_id = p_conversation_id and status in ('joined', 'invited');

  delete from public.conversation_members where conversation_id = p_conversation_id and user_id = p_user_id;

  perform private.insert_system_message(
    p_conversation_id, v_uid, 'member_removed', jsonb_build_object('user_id', p_user_id)
  );

  perform realtime.send(
    jsonb_build_object('conversation_id', p_conversation_id),
    'membership_removed',
    'user:' || p_user_id::text,
    true
  );
end;
$$;

create or replace function public.set_group_member_role(p_conversation_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_actor_role text;
  v_target_role text;
begin
  if p_role not in ('owner', 'admin', 'member') then
    raise exception 'Invalid role.' using errcode = '22023';
  end if;

  v_actor_role := private.require_group_role(p_conversation_id, v_uid, array['owner', 'admin']);
  v_target_role := private.member_role(p_conversation_id, p_user_id);

  if v_target_role is null then
    raise exception 'That person is not in this group.' using errcode = 'P0002';
  end if;

  if v_target_role = p_role then
    return;
  end if;

  if p_role = 'owner' then
    if v_actor_role <> 'owner' then
      raise exception 'Only the owner can transfer ownership.' using errcode = '42501';
    end if;
    update public.conversation_members set role = 'admin'
    where conversation_id = p_conversation_id and user_id = v_uid;
    update public.conversation_members set role = 'owner'
    where conversation_id = p_conversation_id and user_id = p_user_id;
    perform private.insert_system_message(
      p_conversation_id, v_uid, 'owner_changed', jsonb_build_object('user_id', p_user_id)
    );
    return;
  end if;

  if v_target_role = 'owner' then
    raise exception 'Transfer ownership before changing the owner''s role.' using errcode = '42501';
  end if;

  if v_target_role = 'admin' and v_actor_role <> 'owner' then
    raise exception 'Only the owner can demote admins.' using errcode = '42501';
  end if;

  update public.conversation_members set role = p_role
  where conversation_id = p_conversation_id and user_id = p_user_id;

  perform private.insert_system_message(
    p_conversation_id, v_uid, 'role_changed', jsonb_build_object('user_id', p_user_id, 'role', p_role)
  );
end;
$$;

-- Removes p_user_id from a group, handing ownership on if needed and deleting the group when
-- nobody is left. Shared by leave_group and account deletion.
create or replace function private.leave_group_internal(p_conversation_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_successor uuid;
begin
  v_role := private.member_role(p_conversation_id, p_user_id);
  if v_role is null then
    return;
  end if;

  update public.call_participants
  set status = 'left', left_at = now()
  where user_id = p_user_id and conversation_id = p_conversation_id and status in ('joined', 'invited');

  delete from public.conversation_members where conversation_id = p_conversation_id and user_id = p_user_id;

  if not exists (select 1 from public.conversation_members m where m.conversation_id = p_conversation_id) then
    delete from public.conversations where id = p_conversation_id;
    return;
  end if;

  if v_role = 'owner' then
    select m.user_id into v_successor
    from public.conversation_members m
    where m.conversation_id = p_conversation_id
    order by (m.role = 'admin') desc, m.joined_at asc
    limit 1;

    update public.conversation_members set role = 'owner'
    where conversation_id = p_conversation_id and user_id = v_successor;
  end if;

  perform private.insert_system_message(
    p_conversation_id, p_user_id, 'member_left',
    jsonb_build_object('user_id', p_user_id, 'new_owner_id', v_successor)
  );
end;
$$;

create or replace function public.leave_group(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
begin
  perform private.require_group_role(p_conversation_id, v_uid, array['owner', 'admin', 'member']);
  perform private.leave_group_internal(p_conversation_id, v_uid);
end;
$$;

-- Deletes the group and everything in it. Storage objects are queued for removal by triggers.
-- Returns the member ids so the server can notify them and close any LiveKit room.
create or replace function public.delete_group(p_conversation_id uuid)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_members uuid[];
  v_member uuid;
begin
  perform private.require_group_role(p_conversation_id, v_uid, array['owner']);

  select coalesce(array_agg(m.user_id), '{}') into v_members
  from public.conversation_members m
  where m.conversation_id = p_conversation_id;

  delete from public.conversations where id = p_conversation_id;

  foreach v_member in array v_members
  loop
    perform realtime.send(
      jsonb_build_object('conversation_id', p_conversation_id),
      'conversation_deleted',
      'user:' || v_member::text,
      true
    );
  end loop;

  return v_members;
end;
$$;

-- ------------------------------------------------------------------ invitation links
create or replace function public.create_group_invite(
  p_conversation_id uuid,
  p_expires_in_hours integer default 168,
  p_max_uses integer default null
)
returns public.group_invites
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_invite public.group_invites;
begin
  perform private.require_group_role(p_conversation_id, v_uid, array['owner', 'admin']);

  if p_expires_in_hours is null or p_expires_in_hours < 1 or p_expires_in_hours > 720 then
    raise exception 'Invite links must expire within 30 days.' using errcode = '22023';
  end if;

  if p_max_uses is not null and (p_max_uses < 1 or p_max_uses > 1000) then
    raise exception 'Max uses must be between 1 and 1000.' using errcode = '22023';
  end if;

  if (
    select count(*) from public.group_invites i
    where i.conversation_id = p_conversation_id and i.revoked_at is null and i.expires_at > now()
  ) >= 20 then
    raise exception 'Revoke an existing link before creating another.' using errcode = 'P0001', hint = 'invite_limit';
  end if;

  insert into public.group_invites (conversation_id, created_by, expires_at, max_uses)
  values (p_conversation_id, v_uid, now() + make_interval(hours => p_expires_in_hours), p_max_uses)
  returning * into v_invite;

  return v_invite;
end;
$$;

create or replace function public.revoke_group_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_conversation_id uuid;
begin
  select i.conversation_id into v_conversation_id from public.group_invites i where i.id = p_invite_id;
  if v_conversation_id is null then
    raise exception 'Invite link not found.' using errcode = 'P0002';
  end if;

  perform private.require_group_role(v_conversation_id, v_uid, array['owner', 'admin']);

  update public.group_invites set revoked_at = now() where id = p_invite_id and revoked_at is null;
end;
$$;

create or replace function public.get_group_invite_preview(p_token text)
returns table (
  conversation_id uuid,
  name text,
  description text,
  member_count integer,
  is_member boolean,
  expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
begin
  return query
  select c.id, c.name, c.description,
    (select count(*)::integer from public.conversation_members m where m.conversation_id = c.id),
    private.is_user_member(c.id, v_uid),
    i.expires_at
  from public.group_invites i
  join public.conversations c on c.id = i.conversation_id
  where i.token = btrim(coalesce(p_token, ''))
    and i.revoked_at is null
    and i.expires_at > now()
    and (i.max_uses is null or i.use_count < i.max_uses);
end;
$$;

create or replace function public.join_group_via_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_invite public.group_invites;
  v_count integer;
begin
  select * into v_invite
  from public.group_invites i
  where i.token = btrim(coalesce(p_token, ''))
  for update;

  if not found
    or v_invite.revoked_at is not null
    or v_invite.expires_at <= now()
    or (v_invite.max_uses is not null and v_invite.use_count >= v_invite.max_uses) then
    raise exception 'This invite link is invalid or has expired.' using errcode = 'P0001', hint = 'invite_invalid';
  end if;

  if private.is_user_member(v_invite.conversation_id, v_uid) then
    return v_invite.conversation_id;
  end if;

  select count(*) into v_count from public.conversation_members m where m.conversation_id = v_invite.conversation_id;
  if v_count >= private.group_member_limit() then
    raise exception 'This group is full.' using errcode = 'P0001', hint = 'group_full';
  end if;

  insert into public.conversation_members (conversation_id, user_id, role, added_by)
  values (v_invite.conversation_id, v_uid, 'member', v_invite.created_by);

  update public.group_invites set use_count = use_count + 1 where id = v_invite.id;

  perform private.insert_system_message(
    v_invite.conversation_id, v_uid, 'member_joined', jsonb_build_object('user_id', v_uid, 'via', 'invite_link')
  );

  return v_invite.conversation_id;
end;
$$;

-- Function privileges are managed centrally in 20261013120900_privileges.sql.
