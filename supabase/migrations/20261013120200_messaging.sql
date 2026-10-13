-- KJ Chat: messaging functions
--
-- Error conventions (surfaced through PostgREST as { code, message, hint }):
--   28000 not authenticated   42501 forbidden   P0002 not found
--   22023 invalid input        P0001 business rule violation (hint carries a machine code)

-- ------------------------------------------------------------------ internal helpers
create or replace function private.require_user()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'You must be signed in.' using errcode = '28000';
  end if;
  return v_uid;
end;
$$;

create or replace function private.escape_like(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(replace(replace(p_value, '\', '\\'), '%', '\%'), '_', '\_');
$$;

create or replace function private.insert_system_message(
  p_conversation_id uuid,
  p_actor_id uuid,
  p_event text,
  p_data jsonb default '{}'::jsonb
)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msg public.messages;
begin
  insert into public.messages (conversation_id, sender_id, message_type, metadata)
  values (p_conversation_id, p_actor_id, 'system', jsonb_build_object('event', p_event) || coalesce(p_data, '{}'::jsonb))
  returning * into v_msg;

  update public.conversations
  set last_message_at = v_msg.created_at
  where id = p_conversation_id;

  return v_msg;
end;
$$;

-- Advances the caller's private read marker and, if they allow it, their public receipt.
create or replace function private.advance_read_marker(p_conversation_id uuid, p_user_id uuid, p_ts timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipts boolean;
begin
  if p_ts is null then
    return;
  end if;

  update public.conversation_preferences
  set last_read_at = p_ts
  where conversation_id = p_conversation_id
    and user_id = p_user_id
    and (last_read_at is null or last_read_at < p_ts);

  select coalesce(s.read_receipts_enabled, true) into v_receipts
  from public.user_settings s
  where s.user_id = p_user_id;

  update public.conversation_members
  set last_read_at = case when coalesce(v_receipts, true) then greatest(coalesce(last_read_at, p_ts), p_ts) else last_read_at end,
      last_delivered_at = greatest(coalesce(last_delivered_at, p_ts), p_ts)
  where conversation_id = p_conversation_id
    and user_id = p_user_id
    and (
      last_delivered_at is null or last_delivered_at < p_ts
      or (coalesce(v_receipts, true) and (last_read_at is null or last_read_at < p_ts))
    );
end;
$$;

-- ------------------------------------------------------------------ profiles & presence
create or replace function public.get_registration_mode()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not exists (select 1 from public.profiles) then 'open'
    else coalesce((select s.registration_mode from public.app_settings s where s.id), 'invite')
  end;
$$;

create or replace function public.validate_app_invite(p_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.app_invitations i
    where i.code = btrim(p_code)
      and i.revoked_at is null
      and (i.expires_at is null or i.expires_at > now())
      and i.use_count < i.max_uses
  );
$$;

create or replace function public.is_username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select lower(btrim(p_username)) ~ '^[a-z0-9_]{3,30}$'
    and not exists (
      select 1 from public.profiles p
      where p.username = lower(btrim(p_username))
        and p.id <> coalesce((select auth.uid()), '00000000-0000-0000-0000-000000000000'::uuid)
    );
$$;

create or replace function public.search_profiles(p_query text, p_limit integer default 20)
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_path text,
  status_text text,
  is_blocked boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_q text := btrim(coalesce(p_query, ''));
begin
  if char_length(v_q) < 1 then
    return;
  end if;

  return query
  select p.id, p.username, p.display_name, p.avatar_path, p.status_text,
    exists (select 1 from public.user_blocks b where b.blocker_id = v_uid and b.blocked_id = p.id)
  from public.profiles p
  where p.id <> v_uid
    and p.username is not null
    -- Users who blocked the caller are not discoverable by them.
    and not exists (select 1 from public.user_blocks b where b.blocker_id = p.id and b.blocked_id = v_uid)
    and (
      p.username ilike '%' || private.escape_like(lower(v_q)) || '%'
      or p.display_name ilike '%' || private.escape_like(v_q) || '%'
    )
  order by (p.username = lower(v_q)) desc, p.display_name
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

create or replace function public.touch_last_seen()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
begin
  insert into public.user_last_seen (user_id, last_seen_at)
  values (v_uid, now())
  on conflict (user_id) do update set last_seen_at = excluded.last_seen_at;
end;
$$;

-- ------------------------------------------------------------------ conversations
create or replace function public.get_or_create_direct_conversation(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_key text;
  v_id uuid;
begin
  if p_other_user_id is null or p_other_user_id = v_uid then
    raise exception 'Choose someone else to message.' using errcode = '22023';
  end if;

  if not exists (select 1 from public.profiles p where p.id = p_other_user_id) then
    raise exception 'That user does not exist.' using errcode = 'P0002';
  end if;

  v_key := least(v_uid::text, p_other_user_id::text) || ':' || greatest(v_uid::text, p_other_user_id::text);

  select c.id into v_id from public.conversations c where c.direct_key = v_key;
  if v_id is not null then
    return v_id;
  end if;

  if private.is_blocked_between(v_uid, p_other_user_id) then
    raise exception 'You cannot start a conversation with this user.' using errcode = '42501', hint = 'blocked';
  end if;

  insert into public.conversations (type, direct_key, created_by)
  values ('direct', v_key, v_uid)
  on conflict (direct_key) do nothing
  returning id into v_id;

  if v_id is null then
    -- Lost a race with the other participant; their insert won.
    select c.id into v_id from public.conversations c where c.direct_key = v_key;
    return v_id;
  end if;

  insert into public.conversation_members (conversation_id, user_id, role, added_by)
  values (v_id, v_uid, 'member', v_uid), (v_id, p_other_user_id, 'member', v_uid);

  return v_id;
end;
$$;

create or replace function public.get_conversations()
returns table (
  id uuid,
  type text,
  name text,
  description text,
  avatar_path text,
  created_at timestamptz,
  last_message_at timestamptz,
  my_role text,
  member_count integer,
  peer jsonb,
  last_message jsonb,
  unread_count integer,
  mention_count integer,
  muted_until timestamptz,
  archived_at timestamptz,
  pinned_at timestamptz,
  notification_level text,
  cleared_at timestamptz,
  last_read_at timestamptz,
  active_call jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.id,
    c.type,
    c.name,
    c.description,
    c.avatar_path,
    c.created_at,
    c.last_message_at,
    me.role,
    (select count(*)::integer from public.conversation_members x where x.conversation_id = c.id),
    case when c.type = 'direct' then (
      select jsonb_build_object(
        'id', p.id, 'username', p.username, 'display_name', p.display_name,
        'avatar_path', p.avatar_path, 'status_text', p.status_text
      )
      from public.conversation_members x
      join public.profiles p on p.id = x.user_id
      where x.conversation_id = c.id and x.user_id <> me.user_id
      limit 1
    ) end,
    lm.msg,
    coalesce(unread.n, 0),
    coalesce(mentions.n, 0),
    pr.muted_until,
    pr.archived_at,
    pr.pinned_at,
    coalesce(pr.notification_level, 'all'),
    pr.cleared_at,
    pr.last_read_at,
    live_call.info
  from public.conversation_members me
  join public.conversations c on c.id = me.conversation_id
  left join public.conversation_preferences pr
    on pr.conversation_id = me.conversation_id and pr.user_id = me.user_id
  left join lateral (
    select jsonb_build_object(
      'id', m.id,
      'sender_id', m.sender_id,
      'sender_name', sp.display_name,
      'message_type', m.message_type,
      'content', left(m.content, 160),
      'metadata', m.metadata,
      'deleted_at', m.deleted_at,
      'created_at', m.created_at,
      'attachment_count', (select count(*) from public.attachments a where a.message_id = m.id)
    ) as msg
    from public.messages m
    left join public.profiles sp on sp.id = m.sender_id
    where m.conversation_id = c.id
      and (pr.cleared_at is null or m.created_at > pr.cleared_at)
      and not exists (select 1 from public.message_hidden h where h.message_id = m.id and h.user_id = me.user_id)
    order by m.created_at desc, m.id desc
    limit 1
  ) lm on true
  left join lateral (
    select count(*)::integer as n
    from (
      select 1
      from public.messages m
      where m.conversation_id = c.id
        and m.created_at > coalesce(pr.last_read_at, '-infinity'::timestamptz)
        and (pr.cleared_at is null or m.created_at > pr.cleared_at)
        and m.sender_id is distinct from me.user_id
        and m.deleted_at is null
        and m.message_type <> 'system'
        and not exists (select 1 from public.message_hidden h where h.message_id = m.id and h.user_id = me.user_id)
      limit 999
    ) u
  ) unread on true
  left join lateral (
    select count(*)::integer as n
    from public.message_mentions mm
    join public.messages m on m.id = mm.message_id
    where mm.user_id = me.user_id
      and mm.conversation_id = c.id
      and m.created_at > coalesce(pr.last_read_at, '-infinity'::timestamptz)
      and m.deleted_at is null
  ) mentions on true
  left join lateral (
    select jsonb_build_object(
      'id', cs.id, 'media_type', cs.media_type, 'status', cs.status,
      'started_by', cs.started_by, 'created_at', cs.created_at
    ) as info
    from public.call_sessions cs
    where cs.conversation_id = c.id
      and (cs.status = 'active' or (cs.status = 'ringing' and cs.ring_expires_at > now()))
    limit 1
  ) live_call on true
  where me.user_id = (select auth.uid())
    -- A cleared direct chat disappears from the list until a newer message arrives.
    and not (
      c.type = 'direct'
      and pr.cleared_at is not null
      and (c.last_message_at is null or c.last_message_at <= pr.cleared_at)
    )
  order by coalesce(c.last_message_at, c.created_at) desc;
$$;

create or replace function public.clear_conversation(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
begin
  if not private.is_user_member(p_conversation_id, v_uid) then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;

  update public.conversation_preferences
  set cleared_at = now(), last_read_at = greatest(coalesce(last_read_at, now()), now())
  where conversation_id = p_conversation_id and user_id = v_uid;
end;
$$;

-- ------------------------------------------------------------------ message read model
create view public.message_details
with (security_invoker = true)
as
select
  m.id,
  m.conversation_id,
  m.sender_id,
  m.client_id,
  m.message_type,
  m.content,
  m.metadata,
  m.reply_to_message_id,
  m.is_forwarded,
  m.created_at,
  m.updated_at,
  m.edited_at,
  m.deleted_at,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id,
      'storage_path', a.storage_path,
      'file_name', a.file_name,
      'mime_type', a.mime_type,
      'file_size', a.file_size,
      'kind', a.kind,
      'width', a.width,
      'height', a.height,
      'duration_ms', a.duration_ms,
      'waveform', a.waveform
    ) order by a.created_at, a.id)
    from public.attachments a
    where a.message_id = m.id
  ), '[]'::jsonb) as attachments,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'user_id', r.user_id, 'emoji', r.emoji, 'created_at', r.created_at
    ) order by r.created_at, r.id)
    from public.message_reactions r
    where r.message_id = m.id
  ), '[]'::jsonb) as reactions,
  (
    select jsonb_build_object(
      'id', rm.id,
      'sender_id', rm.sender_id,
      'message_type', rm.message_type,
      'content', left(rm.content, 200),
      'deleted_at', rm.deleted_at,
      'attachment_kind', (
        select a.kind from public.attachments a where a.message_id = rm.id order by a.created_at limit 1
      )
    )
    from public.messages rm
    where rm.id = m.reply_to_message_id
  ) as reply_to
from public.messages m;

revoke all on public.message_details from anon, authenticated;
grant select on public.message_details to authenticated;

create or replace function public.get_messages(
  p_conversation_id uuid,
  p_before_id uuid default null,
  p_limit integer default 50
)
returns setof public.message_details
language sql
stable
security invoker
set search_path = ''
as $$
  -- The cursor is a message id (not a timestamp) so clients never lose microsecond precision.
  select d.*
  from public.message_details d
  where d.conversation_id = p_conversation_id
    and (
      p_before_id is null
      or (d.created_at, d.id) < (
        select c.created_at, c.id from public.messages c
        where c.id = p_before_id and c.conversation_id = p_conversation_id
      )
    )
    and not exists (
      select 1 from public.message_hidden h where h.message_id = d.id and h.user_id = (select auth.uid())
    )
    and d.created_at > coalesce((
      select pr.cleared_at
      from public.conversation_preferences pr
      where pr.conversation_id = p_conversation_id and pr.user_id = (select auth.uid())
    ), '-infinity'::timestamptz)
  order by d.created_at desc, d.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

create or replace function public.get_messages_by_ids(p_ids uuid[])
returns setof public.message_details
language sql
stable
security invoker
set search_path = ''
as $$
  select d.*
  from public.message_details d
  where d.id = any (p_ids[1:200])
    and not exists (
      select 1 from public.message_hidden h where h.message_id = d.id and h.user_id = (select auth.uid())
    )
  order by d.created_at, d.id;
$$;

create or replace function public.search_messages(
  p_query text,
  p_conversation_id uuid default null,
  p_limit integer default 30
)
returns table (
  id uuid,
  conversation_id uuid,
  sender_id uuid,
  message_type text,
  content text,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select m.id, m.conversation_id, m.sender_id, m.message_type, m.content, m.created_at
  from public.messages m
  left join public.conversation_preferences pr
    on pr.conversation_id = m.conversation_id and pr.user_id = (select auth.uid())
  where char_length(btrim(coalesce(p_query, ''))) >= 2
    and (p_conversation_id is null or m.conversation_id = p_conversation_id)
    and m.deleted_at is null
    and m.content ilike '%' || private.escape_like(btrim(p_query)) || '%'
    and (pr.cleared_at is null or m.created_at > pr.cleared_at)
    and not exists (
      select 1 from public.message_hidden h where h.message_id = m.id and h.user_id = (select auth.uid())
    )
  order by m.created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 50);
$$;

-- ------------------------------------------------------------------ sending
-- Executable by service_role only. The Next.js route verifies the caller's session, validates
-- and content-sniffs attachments, applies rate limits, then calls this with the verified id.
create or replace function public.send_message(
  p_sender_id uuid,
  p_conversation_id uuid,
  p_client_id uuid,
  p_content text default null,
  p_reply_to_message_id uuid default null,
  p_attachments jsonb default '[]'::jsonb,
  p_is_forwarded boolean default false
)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv public.conversations;
  v_msg public.messages;
  v_peer uuid;
  v_attachments jsonb := coalesce(p_attachments, '[]'::jsonb);
  v_count integer;
  v_att jsonb;
  v_path text;
  v_kind text;
  v_has_text boolean := p_content is not null and btrim(p_content) <> '';
begin
  if p_sender_id is null or p_conversation_id is null or p_client_id is null then
    raise exception 'Missing message fields.' using errcode = '22023';
  end if;

  -- Idempotency: a retried request returns the original message.
  select * into v_msg from public.messages m where m.sender_id = p_sender_id and m.client_id = p_client_id;
  if found then
    if v_msg.conversation_id <> p_conversation_id then
      raise exception 'Duplicate message id.' using errcode = '22023';
    end if;
    return v_msg;
  end if;

  select * into v_conv from public.conversations c where c.id = p_conversation_id;
  if not found or not private.is_user_member(p_conversation_id, p_sender_id) then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;

  if v_conv.type = 'direct' then
    v_peer := private.direct_peer(p_conversation_id, p_sender_id);
    if v_peer is null then
      raise exception 'This account no longer exists.' using errcode = '42501', hint = 'peer_deleted';
    end if;
    if private.is_blocked_between(p_sender_id, v_peer) then
      raise exception 'You cannot send messages in this conversation.' using errcode = '42501', hint = 'blocked';
    end if;
  end if;

  if jsonb_typeof(v_attachments) <> 'array' then
    raise exception 'Attachments must be a list.' using errcode = '22023';
  end if;

  v_count := jsonb_array_length(v_attachments);
  if v_count > 10 then
    raise exception 'You can attach up to 10 files per message.' using errcode = '22023';
  end if;

  if not v_has_text and v_count = 0 then
    raise exception 'Message is empty.' using errcode = '22023';
  end if;

  if char_length(p_content) > 4000 then
    raise exception 'Message is too long (4000 characters max).' using errcode = '22023';
  end if;

  if p_reply_to_message_id is not null and not exists (
    select 1 from public.messages r
    where r.id = p_reply_to_message_id
      and r.conversation_id = p_conversation_id
      and r.deleted_at is null
  ) then
    raise exception 'The message you are replying to is no longer available.' using errcode = 'P0002';
  end if;

  insert into public.messages (
    conversation_id, sender_id, client_id, message_type, content, reply_to_message_id, is_forwarded
  )
  values (
    p_conversation_id,
    p_sender_id,
    p_client_id,
    case when v_count > 0 then coalesce(v_attachments -> 0 ->> 'kind', 'file') else 'text' end,
    case when v_has_text then p_content else null end,
    p_reply_to_message_id,
    coalesce(p_is_forwarded, false)
  )
  returning * into v_msg;

  for v_att in select value from jsonb_array_elements(v_attachments)
  loop
    v_path := v_att ->> 'path';
    v_kind := v_att ->> 'kind';

    -- Storage policies only allow uploads into "<conversation>/<uploader>/<uuid>/<file>",
    -- so this prefix check also proves the sender uploaded the object.
    if v_path is null
      or v_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[^/]{1,200}$'
      or split_part(v_path, '/', 1) <> p_conversation_id::text
      or split_part(v_path, '/', 2) <> p_sender_id::text then
      raise exception 'Invalid attachment.' using errcode = '22023';
    end if;

    if v_kind is null or v_kind not in ('image', 'video', 'audio', 'voice', 'file') then
      raise exception 'Invalid attachment type.' using errcode = '22023';
    end if;

    insert into public.attachments (
      message_id, conversation_id, uploader_id, storage_path, file_name, mime_type, file_size,
      kind, width, height, duration_ms, waveform
    )
    values (
      v_msg.id,
      p_conversation_id,
      p_sender_id,
      v_path,
      left(coalesce(nullif(btrim(v_att ->> 'file_name'), ''), 'file'), 255),
      v_att ->> 'mime_type',
      (v_att ->> 'file_size')::bigint,
      v_kind,
      nullif(v_att ->> 'width', '')::integer,
      nullif(v_att ->> 'height', '')::integer,
      nullif(v_att ->> 'duration_ms', '')::integer,
      case when jsonb_typeof(v_att -> 'waveform') = 'array' then v_att -> 'waveform' else null end
    );
  end loop;

  if v_has_text and v_conv.type = 'group' then
    insert into public.message_mentions (message_id, user_id, conversation_id)
    select distinct v_msg.id, p.id, p_conversation_id
    from regexp_matches(v_msg.content, '@([A-Za-z0-9_]{3,30})', 'g') as mention(parts)
    join public.profiles p on p.username = lower(mention.parts[1])
    join public.conversation_members cm on cm.conversation_id = p_conversation_id and cm.user_id = p.id
    where p.id <> p_sender_id;
  end if;

  update public.conversations
  set last_message_at = v_msg.created_at
  where id = p_conversation_id;

  perform private.advance_read_marker(p_conversation_id, p_sender_id, v_msg.created_at);

  return v_msg;
end;
$$;

create or replace function public.edit_message(p_message_id uuid, p_content text)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_msg public.messages;
  v_has_text boolean := p_content is not null and btrim(p_content) <> '';
begin
  select * into v_msg from public.messages m where m.id = p_message_id for update;

  if not found or not private.is_user_member(v_msg.conversation_id, v_uid) then
    raise exception 'Message not found.' using errcode = 'P0002';
  end if;

  if v_msg.sender_id is distinct from v_uid then
    raise exception 'You can only edit your own messages.' using errcode = '42501';
  end if;

  if v_msg.deleted_at is not null or v_msg.message_type in ('system', 'call', 'voice') then
    raise exception 'This message cannot be edited.' using errcode = 'P0001', hint = 'not_editable';
  end if;

  if v_msg.created_at < now() - interval '48 hours' then
    raise exception 'Messages can only be edited within 48 hours.' using errcode = 'P0001', hint = 'edit_window';
  end if;

  if v_msg.message_type = 'text' and not v_has_text then
    raise exception 'Message cannot be empty.' using errcode = '22023';
  end if;

  if char_length(p_content) > 4000 then
    raise exception 'Message is too long (4000 characters max).' using errcode = '22023';
  end if;

  if v_msg.content is not distinct from (case when v_has_text then p_content else null end) then
    return v_msg;
  end if;

  update public.messages
  set content = case when v_has_text then p_content else null end,
      edited_at = now(),
      updated_at = now()
  where id = p_message_id
  returning * into v_msg;

  delete from public.message_mentions where message_id = p_message_id;
  if v_has_text and exists (select 1 from public.conversations c where c.id = v_msg.conversation_id and c.type = 'group') then
    insert into public.message_mentions (message_id, user_id, conversation_id)
    select distinct v_msg.id, p.id, v_msg.conversation_id
    from regexp_matches(v_msg.content, '@([A-Za-z0-9_]{3,30})', 'g') as mention(parts)
    join public.profiles p on p.username = lower(mention.parts[1])
    join public.conversation_members cm on cm.conversation_id = v_msg.conversation_id and cm.user_id = p.id
    where p.id <> v_uid;
  end if;

  return v_msg;
end;
$$;

-- Deleting for everyone tombstones the row (content and attachments removed); storage objects
-- are queued for deletion by the attachments trigger.
create or replace function public.delete_message(p_message_id uuid, p_for_everyone boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_msg public.messages;
  v_role text;
  v_type text;
begin
  select * into v_msg from public.messages m where m.id = p_message_id for update;

  if not found or not private.is_user_member(v_msg.conversation_id, v_uid) then
    raise exception 'Message not found.' using errcode = 'P0002';
  end if;

  if not coalesce(p_for_everyone, false) then
    insert into public.message_hidden (user_id, message_id)
    values (v_uid, p_message_id)
    on conflict do nothing;
    return;
  end if;

  if v_msg.deleted_at is not null then
    return;
  end if;

  select c.type into v_type from public.conversations c where c.id = v_msg.conversation_id;
  v_role := private.member_role(v_msg.conversation_id, v_uid);

  if v_msg.message_type = 'system' then
    raise exception 'System messages cannot be deleted for everyone.' using errcode = '42501';
  end if;

  if v_msg.sender_id is distinct from v_uid and not (v_type = 'group' and v_role in ('owner', 'admin')) then
    raise exception 'You can only delete your own messages for everyone.' using errcode = '42501';
  end if;

  delete from public.attachments where message_id = p_message_id;
  delete from public.message_reactions where message_id = p_message_id;
  delete from public.message_mentions where message_id = p_message_id;
  delete from public.pinned_messages where message_id = p_message_id;

  update public.messages
  set deleted_at = now(),
      content = null,
      metadata = jsonb_build_object('deleted_by', v_uid),
      updated_at = now()
  where id = p_message_id;
end;
$$;

create or replace function public.toggle_reaction(p_message_id uuid, p_emoji text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_msg public.messages;
  v_type text;
  v_peer uuid;
  v_existing public.message_reactions;
  v_emoji text := btrim(coalesce(p_emoji, ''));
begin
  if v_emoji !~ '^\S{1,16}$' then
    raise exception 'Invalid reaction.' using errcode = '22023';
  end if;

  select * into v_msg from public.messages m where m.id = p_message_id;
  if not found or not private.is_user_member(v_msg.conversation_id, v_uid) then
    raise exception 'Message not found.' using errcode = 'P0002';
  end if;

  if v_msg.deleted_at is not null or v_msg.message_type = 'system' then
    raise exception 'You cannot react to this message.' using errcode = 'P0001', hint = 'not_reactable';
  end if;

  select c.type into v_type from public.conversations c where c.id = v_msg.conversation_id;
  if v_type = 'direct' then
    v_peer := private.direct_peer(v_msg.conversation_id, v_uid);
    if v_peer is not null and private.is_blocked_between(v_uid, v_peer) then
      raise exception 'You cannot react in this conversation.' using errcode = '42501', hint = 'blocked';
    end if;
  end if;

  select * into v_existing
  from public.message_reactions r
  where r.message_id = p_message_id and r.user_id = v_uid and r.emoji = v_emoji;

  if found then
    delete from public.message_reactions where id = v_existing.id;
    -- Deletions are pushed over a private broadcast topic instead of postgres_changes.
    perform realtime.send(
      jsonb_build_object('id', v_existing.id, 'message_id', p_message_id, 'user_id', v_uid, 'emoji', v_emoji),
      'reaction_removed',
      'conversation:' || v_msg.conversation_id::text,
      true
    );
    return false;
  end if;

  if (select count(*) from public.message_reactions r where r.message_id = p_message_id and r.user_id = v_uid) >= 10 then
    raise exception 'You can add up to 10 reactions per message.' using errcode = 'P0001', hint = 'reaction_limit';
  end if;

  insert into public.message_reactions (message_id, conversation_id, user_id, emoji)
  values (p_message_id, v_msg.conversation_id, v_uid, v_emoji);
  return true;
end;
$$;

-- Marks everything up to (and including) p_message_id as read; null means "all messages".
create or replace function public.mark_conversation_read(p_conversation_id uuid, p_message_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_ts timestamptz;
begin
  if not private.is_user_member(p_conversation_id, v_uid) then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;

  if p_message_id is null then
    select max(m.created_at) into v_ts from public.messages m where m.conversation_id = p_conversation_id;
  else
    select m.created_at into v_ts
    from public.messages m
    where m.id = p_message_id and m.conversation_id = p_conversation_id;
  end if;

  perform private.advance_read_marker(p_conversation_id, v_uid, v_ts);
end;
$$;

create or replace function public.mark_delivered()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
begin
  update public.conversation_members cm
  set last_delivered_at = now()
  where cm.user_id = v_uid
    and exists (
      select 1 from public.messages m
      where m.conversation_id = cm.conversation_id
        and m.created_at > coalesce(cm.last_delivered_at, '-infinity'::timestamptz)
        and m.sender_id is distinct from v_uid
    );
end;
$$;

-- ------------------------------------------------------------------ pins
create or replace function public.pin_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_msg public.messages;
  v_type text;
begin
  select * into v_msg from public.messages m where m.id = p_message_id;
  if not found or not private.is_user_member(v_msg.conversation_id, v_uid) then
    raise exception 'Message not found.' using errcode = 'P0002';
  end if;

  select c.type into v_type from public.conversations c where c.id = v_msg.conversation_id;
  if v_type = 'group' and private.member_role(v_msg.conversation_id, v_uid) not in ('owner', 'admin') then
    raise exception 'Only group admins can pin messages.' using errcode = '42501';
  end if;

  if v_msg.deleted_at is not null or v_msg.message_type = 'system' then
    raise exception 'This message cannot be pinned.' using errcode = 'P0001', hint = 'not_pinnable';
  end if;

  if (select count(*) from public.pinned_messages p where p.conversation_id = v_msg.conversation_id) >= 50 then
    raise exception 'A conversation can have at most 50 pinned messages.' using errcode = 'P0001', hint = 'pin_limit';
  end if;

  insert into public.pinned_messages (conversation_id, message_id, pinned_by)
  values (v_msg.conversation_id, p_message_id, v_uid)
  on conflict do nothing;
end;
$$;

create or replace function public.unpin_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_pin public.pinned_messages;
  v_type text;
begin
  select * into v_pin from public.pinned_messages p where p.message_id = p_message_id;
  if not found or not private.is_user_member(v_pin.conversation_id, v_uid) then
    raise exception 'Pinned message not found.' using errcode = 'P0002';
  end if;

  select c.type into v_type from public.conversations c where c.id = v_pin.conversation_id;
  if v_type = 'group' and private.member_role(v_pin.conversation_id, v_uid) not in ('owner', 'admin') then
    raise exception 'Only group admins can unpin messages.' using errcode = '42501';
  end if;

  delete from public.pinned_messages where conversation_id = v_pin.conversation_id and message_id = p_message_id;
  perform realtime.send(
    jsonb_build_object('message_id', p_message_id),
    'pin_removed',
    'conversation:' || v_pin.conversation_id::text,
    true
  );
end;
$$;

-- ------------------------------------------------------------------ reports & push
create or replace function public.report_content(
  p_reported_user_id uuid,
  p_message_id uuid,
  p_reason text,
  p_details text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_target uuid := p_reported_user_id;
  v_msg public.messages;
  v_id uuid;
begin
  if p_message_id is not null then
    select * into v_msg from public.messages m where m.id = p_message_id;
    if not found or not private.is_user_member(v_msg.conversation_id, v_uid) then
      raise exception 'Message not found.' using errcode = 'P0002';
    end if;
    v_target := coalesce(v_target, v_msg.sender_id);
  end if;

  if v_target is null or v_target = v_uid or not exists (select 1 from public.profiles p where p.id = v_target) then
    raise exception 'Choose a valid user or message to report.' using errcode = '22023';
  end if;

  if (
    select count(*) from public.user_reports r
    where r.reporter_id = v_uid and r.created_at > now() - interval '1 day'
  ) >= 20 then
    raise exception 'You have reached the daily report limit.' using errcode = 'P0001', hint = 'rate_limited';
  end if;

  insert into public.user_reports (reporter_id, reported_user_id, message_id, reason, details)
  values (v_uid, v_target, p_message_id, p_reason, nullif(btrim(coalesce(p_details, '')), ''))
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.register_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_id uuid;
begin
  -- An endpoint identifies one browser profile; re-registering moves it to the current user.
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (v_uid, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 512))
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent,
        failure_count = 0
  returning id into v_id;

  if (select count(*) from public.push_subscriptions s where s.user_id = v_uid) > 20 then
    delete from public.push_subscriptions
    where id in (
      select s.id from public.push_subscriptions s
      where s.user_id = v_uid
      order by coalesce(s.last_used_at, s.created_at) asc
      limit 1
    );
  end if;

  return v_id;
end;
$$;

-- Function privileges are managed centrally in 20261013120900_privileges.sql.
