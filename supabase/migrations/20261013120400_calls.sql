-- KJ Chat: call sessions
--
-- Media flows through LiveKit; the database records who may join which room and the call
-- lifecycle (ringing -> active -> ended). All state transitions run through service_role-only
-- functions called by Next.js route handlers after verifying the caller's session, and by the
-- signature-verified LiveKit webhook. Tokens are only issued after join_call/start_call succeed.

create or replace function private.insert_call_log(p_call public.call_sessions)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msg public.messages;
begin
  insert into public.messages (conversation_id, sender_id, message_type, metadata)
  values (
    p_call.conversation_id,
    p_call.started_by,
    'call',
    jsonb_build_object(
      'call_id', p_call.id,
      'media_type', p_call.media_type,
      'end_reason', p_call.end_reason,
      'duration_seconds', case
        when p_call.answered_at is not null and p_call.ended_at is not null
          then greatest(0, floor(extract(epoch from (p_call.ended_at - p_call.answered_at))))::integer
        else 0
      end
    )
  )
  returning * into v_msg;

  update public.conversations set last_message_at = v_msg.created_at where id = p_call.conversation_id;
end;
$$;

create or replace function private.finish_call(p_call_id uuid, p_reason text)
returns public.call_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_call public.call_sessions;
begin
  update public.call_sessions
  set status = 'ended', end_reason = p_reason, ended_at = now()
  where id = p_call_id and status <> 'ended'
  returning * into v_call;

  if not found then
    select * into v_call from public.call_sessions where id = p_call_id;
    return v_call;
  end if;

  update public.call_participants
  set status = 'missed'
  where call_id = p_call_id and status = 'invited';

  update public.call_participants
  set status = 'left', left_at = coalesce(left_at, now())
  where call_id = p_call_id and status = 'joined';

  perform private.insert_call_log(v_call);
  return v_call;
end;
$$;

create or replace function private.expire_stale_calls()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  for v_id in
    select cs.id from public.call_sessions cs
    where cs.status = 'ringing' and cs.ring_expires_at <= now()
    for update skip locked
  loop
    perform private.finish_call(v_id, 'missed');
  end loop;

  -- Safety net for calls whose webhook never arrived.
  for v_id in
    select cs.id from public.call_sessions cs
    where cs.status = 'active' and cs.answered_at < now() - interval '12 hours'
    for update skip locked
  loop
    perform private.finish_call(v_id, 'failed');
  end loop;
end;
$$;

create or replace function private.user_live_call(p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select cp.call_id
  from public.call_participants cp
  join public.call_sessions cs on cs.id = cp.call_id
  where cp.user_id = p_user_id
    and cp.status = 'joined'
    and cs.status <> 'ended'
  limit 1;
$$;

create or replace function public.start_call(p_user_id uuid, p_conversation_id uuid, p_media_type text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv public.conversations;
  v_call public.call_sessions;
  v_peer uuid;
  v_other_call uuid;
  v_id uuid := gen_random_uuid();
  v_busy boolean := false;
begin
  if p_media_type not in ('audio', 'video') then
    raise exception 'Invalid call type.' using errcode = '22023';
  end if;

  perform private.expire_stale_calls();

  select * into v_conv from public.conversations c where c.id = p_conversation_id;
  if not found or not private.is_user_member(p_conversation_id, p_user_id) then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;

  if v_conv.type = 'direct' then
    v_peer := private.direct_peer(p_conversation_id, p_user_id);
    if v_peer is null then
      raise exception 'This account no longer exists.' using errcode = '42501', hint = 'peer_deleted';
    end if;
    if private.is_blocked_between(p_user_id, v_peer) then
      raise exception 'You cannot call this user.' using errcode = '42501', hint = 'blocked';
    end if;
  end if;

  -- A live call already exists in this conversation: join it instead (also resolves "both
  -- sides pressed call at the same time").
  select * into v_call
  from public.call_sessions cs
  where cs.conversation_id = p_conversation_id and cs.status <> 'ended'
  for update;

  if found then
    v_other_call := private.user_live_call(p_user_id);
    if v_other_call is not null and v_other_call <> v_call.id then
      raise exception 'You are already in another call.' using errcode = 'P0001', hint = 'already_in_call';
    end if;

    insert into public.call_participants (call_id, user_id, conversation_id, status, joined_at)
    values (v_call.id, p_user_id, p_conversation_id, 'joined', now())
    on conflict (call_id, user_id) do update set status = 'joined', joined_at = now(), left_at = null;

    if v_call.started_by is distinct from p_user_id and v_call.status = 'ringing' then
      update public.call_sessions
      set status = 'active', answered_at = coalesce(answered_at, now())
      where id = v_call.id
      returning * into v_call;
    end if;

    return jsonb_build_object('call', to_jsonb(v_call), 'joined_existing', true, 'busy', false);
  end if;

  v_other_call := private.user_live_call(p_user_id);
  if v_other_call is not null then
    raise exception 'You are already in another call.' using errcode = 'P0001', hint = 'already_in_call';
  end if;

  insert into public.call_sessions (id, conversation_id, room_name, media_type, started_by)
  values (v_id, p_conversation_id, 'call_' || replace(v_id::text, '-', ''), p_media_type, p_user_id)
  returning * into v_call;

  insert into public.call_participants (call_id, user_id, conversation_id, status, joined_at)
  values (v_id, p_user_id, p_conversation_id, 'joined', now());

  insert into public.call_participants (call_id, user_id, conversation_id, status)
  select v_id, m.user_id, p_conversation_id,
    case when private.user_live_call(m.user_id) is not null then 'busy' else 'invited' end
  from public.conversation_members m
  where m.conversation_id = p_conversation_id
    and m.user_id <> p_user_id
    and not private.is_blocked_between(p_user_id, m.user_id);

  if v_conv.type = 'direct' then
    select exists (
      select 1 from public.call_participants cp
      where cp.call_id = v_id and cp.user_id = v_peer and cp.status = 'busy'
    ) into v_busy;

    if v_busy then
      v_call := private.finish_call(v_id, 'busy');
    end if;
  end if;

  return jsonb_build_object('call', to_jsonb(v_call), 'joined_existing', false, 'busy', v_busy);
end;
$$;

create or replace function public.join_call(p_user_id uuid, p_call_id uuid)
returns public.call_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_call public.call_sessions;
  v_other_call uuid;
begin
  perform private.expire_stale_calls();

  select * into v_call from public.call_sessions cs where cs.id = p_call_id for update;
  if not found or not private.is_user_member(v_call.conversation_id, p_user_id) then
    raise exception 'Call not found.' using errcode = 'P0002';
  end if;

  -- Returned (not raised) so the expiry above is committed; the caller treats it as "ended".
  if v_call.status = 'ended' then
    return v_call;
  end if;

  -- Participants marked 'busy' when the call started may join once they are free.
  v_other_call := private.user_live_call(p_user_id);
  if v_other_call is not null and v_other_call <> p_call_id then
    raise exception 'You are already in another call.' using errcode = 'P0001', hint = 'already_in_call';
  end if;

  insert into public.call_participants (call_id, user_id, conversation_id, status, joined_at)
  values (p_call_id, p_user_id, v_call.conversation_id, 'joined', now())
  on conflict (call_id, user_id) do update set status = 'joined', joined_at = now(), left_at = null;

  if v_call.started_by is distinct from p_user_id then
    update public.call_sessions
    set status = 'active', answered_at = coalesce(answered_at, now())
    where id = p_call_id
    returning * into v_call;
  end if;

  return v_call;
end;
$$;

create or replace function public.decline_call(p_user_id uuid, p_call_id uuid)
returns public.call_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_call public.call_sessions;
  v_type text;
begin
  select * into v_call from public.call_sessions cs where cs.id = p_call_id for update;
  if not found or not private.is_user_member(v_call.conversation_id, p_user_id) then
    raise exception 'Call not found.' using errcode = 'P0002';
  end if;

  if v_call.status = 'ended' then
    return v_call;
  end if;

  update public.call_participants
  set status = 'declined'
  where call_id = p_call_id and user_id = p_user_id and status in ('invited', 'busy');

  select c.type into v_type from public.conversations c where c.id = v_call.conversation_id;

  if v_type = 'direct' and v_call.status = 'ringing' then
    v_call := private.finish_call(p_call_id, 'declined');
  elsif v_call.status = 'ringing' and not exists (
    select 1 from public.call_participants cp where cp.call_id = p_call_id and cp.status = 'invited'
  ) then
    -- Everybody in the group declined.
    v_call := private.finish_call(p_call_id, 'declined');
  end if;

  return v_call;
end;
$$;

create or replace function public.leave_call(p_user_id uuid, p_call_id uuid)
returns public.call_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_call public.call_sessions;
  v_type text;
begin
  select * into v_call from public.call_sessions cs where cs.id = p_call_id for update;
  if not found then
    raise exception 'Call not found.' using errcode = 'P0002';
  end if;

  if v_call.status = 'ended' then
    return v_call;
  end if;

  if not exists (
    select 1 from public.call_participants cp where cp.call_id = p_call_id and cp.user_id = p_user_id
  ) then
    raise exception 'Call not found.' using errcode = 'P0002';
  end if;

  update public.call_participants
  set status = 'left', left_at = now()
  where call_id = p_call_id and user_id = p_user_id and status = 'joined';

  select c.type into v_type from public.conversations c where c.id = v_call.conversation_id;

  if v_call.status = 'ringing' and v_call.started_by is not distinct from p_user_id then
    return private.finish_call(p_call_id, case when v_call.ring_expires_at <= now() then 'missed' else 'cancelled' end);
  end if;

  if v_type = 'direct' and v_call.status = 'active' then
    return private.finish_call(p_call_id, 'completed');
  end if;

  if not exists (
    select 1 from public.call_participants cp where cp.call_id = p_call_id and cp.status = 'joined'
  ) then
    return private.finish_call(
      p_call_id,
      case when v_call.answered_at is not null then 'completed' else 'cancelled' end
    );
  end if;

  select * into v_call from public.call_sessions where id = p_call_id;
  return v_call;
end;
$$;

-- Used by the server before issuing moderation actions (mute / remove participant).
create or replace function public.can_moderate_call(p_user_id uuid, p_call_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.call_sessions cs
    join public.conversations c on c.id = cs.conversation_id
    left join public.conversation_members m on m.conversation_id = cs.conversation_id and m.user_id = p_user_id
    where cs.id = p_call_id
      and cs.status <> 'ended'
      and m.user_id is not null
      and (cs.started_by = p_user_id or (c.type = 'group' and m.role in ('owner', 'admin')))
  );
$$;

-- ------------------------------------------------------------------ LiveKit webhook hooks
create or replace function public.livekit_participant_left(p_room_name text, p_identity text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_call_id uuid;
  v_user uuid := private.try_uuid(p_identity);
begin
  select cs.id into v_call_id from public.call_sessions cs where cs.room_name = p_room_name and cs.status <> 'ended';
  if v_call_id is null or v_user is null then
    return;
  end if;

  if exists (
    select 1 from public.call_participants cp
    where cp.call_id = v_call_id and cp.user_id = v_user and cp.status = 'joined'
  ) then
    perform public.leave_call(v_user, v_call_id);
  end if;
end;
$$;

create or replace function public.livekit_room_finished(p_room_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_call public.call_sessions;
begin
  select * into v_call from public.call_sessions cs where cs.room_name = p_room_name and cs.status <> 'ended';
  if not found then
    return;
  end if;

  perform private.finish_call(
    v_call.id,
    case when v_call.answered_at is not null then 'completed' else 'cancelled' end
  );
end;
$$;

-- Function privileges are managed centrally in 20261013120900_privileges.sql.
