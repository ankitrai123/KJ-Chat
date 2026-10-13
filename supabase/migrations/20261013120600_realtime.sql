-- KJ Chat: realtime
--
-- Durable data (messages, reactions, receipts, calls, ...) is delivered with Postgres Changes,
-- which re-checks each row against the subscriber's RLS policies. Clients subscribe to INSERT
-- and UPDATE only: DELETE notifications cannot be RLS-filtered, so deletions are announced over
-- private broadcast topics with realtime.send() instead.
--
-- Ephemeral signals (typing, online presence) use private Broadcast/Presence channels that are
-- authorised by the policies on realtime.messages below:
--   online                 any signed-in user (presence)
--   conversation:<uuid>    members of that conversation (typing, reaction/pin removals)
--   user:<uuid>            only that user (membership removed, group deleted)

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'messages', 'message_reactions', 'conversation_members', 'conversations',
    'conversation_preferences', 'call_sessions', 'call_participants', 'pinned_messages'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end;
$$;

create or replace function private.can_access_realtime_topic(p_topic text, p_write boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_topic is null then
    return false;
  end if;

  if p_topic = 'online' then
    return true;
  end if;

  if p_topic like 'conversation:%' then
    return private.is_member(private.try_uuid(substr(p_topic, char_length('conversation:') + 1)));
  end if;

  if p_topic like 'user:%' then
    -- Only the server publishes to personal topics.
    return not p_write and substr(p_topic, char_length('user:') + 1) = v_uid::text;
  end if;

  return false;
end;
$$;

grant execute on function private.can_access_realtime_topic(text, boolean) to authenticated;

create policy "kj realtime: receive on authorised topics"
  on realtime.messages for select to authenticated
  using (private.can_access_realtime_topic((select realtime.topic()), false));

create policy "kj realtime: publish on authorised topics"
  on realtime.messages for insert to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and private.can_access_realtime_topic((select realtime.topic()), true)
  );
