-- KJ Chat: app administration, account deletion, rate limiting and maintenance

-- ------------------------------------------------------------------ app admin (authenticated, admin-checked)
create or replace function private.require_app_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
begin
  if not exists (select 1 from public.app_admins a where a.user_id = v_uid) then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

create or replace function public.admin_set_registration_mode(p_mode text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_app_admin();
  if p_mode not in ('open', 'invite') then
    raise exception 'Invalid registration mode.' using errcode = '22023';
  end if;
  update public.app_settings set registration_mode = p_mode, updated_at = now() where id;
end;
$$;

create or replace function public.admin_create_app_invitation(
  p_email text default null,
  p_note text default null,
  p_expires_in_hours integer default 168,
  p_max_uses integer default 1
)
returns public.app_invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_app_admin();
  v_invite public.app_invitations;
begin
  if p_expires_in_hours is not null and (p_expires_in_hours < 1 or p_expires_in_hours > 2160) then
    raise exception 'Invitations must expire within 90 days.' using errcode = '22023';
  end if;

  insert into public.app_invitations (email, note, created_by, expires_at, max_uses)
  values (
    nullif(lower(btrim(coalesce(p_email, ''))), ''),
    nullif(btrim(coalesce(p_note, '')), ''),
    v_uid,
    case when p_expires_in_hours is null then null else now() + make_interval(hours => p_expires_in_hours) end,
    coalesce(p_max_uses, 1)
  )
  returning * into v_invite;

  return v_invite;
end;
$$;

create or replace function public.admin_revoke_app_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_app_admin();
  update public.app_invitations set revoked_at = now() where id = p_invitation_id and revoked_at is null;
end;
$$;

create or replace function public.admin_update_report(p_report_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_app_admin();
begin
  if p_status not in ('open', 'reviewed', 'dismissed') then
    raise exception 'Invalid status.' using errcode = '22023';
  end if;
  update public.user_reports
  set status = p_status,
      reviewed_by = case when p_status = 'open' then null else v_uid end,
      reviewed_at = case when p_status = 'open' then null else now() end
  where id = p_report_id;
end;
$$;

create or replace function public.admin_set_app_admin(p_user_id uuid, p_is_admin boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_app_admin();

  if p_is_admin then
    insert into public.app_admins (user_id) values (p_user_id) on conflict do nothing;
    return;
  end if;

  if (select count(*) from public.app_admins) <= 1
    and exists (select 1 from public.app_admins a where a.user_id = p_user_id) then
    raise exception 'At least one administrator is required.' using errcode = 'P0001', hint = 'last_admin';
  end if;

  delete from public.app_admins where user_id = p_user_id;
end;
$$;

-- ------------------------------------------------------------------ account deletion (service_role)
-- Called by the server immediately before auth.admin.deleteUser(). Tombstones the user's
-- messages, removes their uploads (queued for storage deletion by trigger), hands over group
-- ownership and ends their calls. The auth deletion then cascades to the profile and all
-- remaining personal rows.
create or replace function public.prepare_account_deletion(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation uuid;
  v_call uuid;
begin
  for v_call in
    select cp.call_id from public.call_participants cp
    join public.call_sessions cs on cs.id = cp.call_id
    where cp.user_id = p_user_id and cp.status = 'joined' and cs.status <> 'ended'
  loop
    perform public.leave_call(p_user_id, v_call);
  end loop;

  delete from public.attachments where uploader_id = p_user_id;

  update public.messages
  set deleted_at = now(), content = null, metadata = '{}'::jsonb, updated_at = now()
  where sender_id = p_user_id
    and deleted_at is null
    and message_type not in ('system', 'call');

  for v_conversation in
    select m.conversation_id
    from public.conversation_members m
    join public.conversations c on c.id = m.conversation_id
    where m.user_id = p_user_id and c.type = 'group'
  loop
    perform private.leave_group_internal(v_conversation, p_user_id);
  end loop;
end;
$$;

-- ------------------------------------------------------------------ rate limiting (service_role)
-- Fixed-window counter shared by all server instances. Returns true when the call is allowed.
create or replace function public.check_rate_limit(p_key text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into private.rate_limits as r (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update
    set count = case
          when r.window_start <= now() - make_interval(secs => p_window_seconds) then 1
          else r.count + 1
        end,
        window_start = case
          when r.window_start <= now() - make_interval(secs => p_window_seconds) then now()
          else r.window_start
        end
  returning count into v_count;

  return v_count <= p_max;
end;
$$;

-- ------------------------------------------------------------------ storage cleanup (service_role)
create or replace function public.dequeue_storage_deletions(p_limit integer default 100)
returns table (id bigint, bucket_id text, path text)
language sql
security definer
set search_path = ''
as $$
  delete from private.storage_deletion_queue q
  where q.id in (
    select s.id from private.storage_deletion_queue s
    order by s.id
    limit least(greatest(coalesce(p_limit, 100), 1), 1000)
    for update skip locked
  )
  returning q.id, q.bucket_id, q.path;
$$;

create or replace function public.requeue_storage_deletions(p_items jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.storage_deletion_queue (bucket_id, path, attempts)
  select i ->> 'bucket_id', i ->> 'path', 1
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as i
  where i ->> 'bucket_id' in ('attachments', 'avatars') and i ->> 'path' is not null;
$$;

-- Periodic housekeeping, run by the server's cron route.
create or replace function public.run_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_orphans integer;
  v_limits integer;
begin
  perform private.expire_stale_calls();

  -- Direct conversations whose participants have all deleted their accounts.
  delete from public.conversations c
  where not exists (select 1 from public.conversation_members m where m.conversation_id = c.id);
  get diagnostics v_orphans = row_count;

  delete from private.rate_limits where window_start < now() - interval '1 day';
  get diagnostics v_limits = row_count;

  delete from public.push_subscriptions where failure_count >= 5;

  return jsonb_build_object('removed_conversations', v_orphans, 'removed_rate_limits', v_limits);
end;
$$;

-- Uploads that were never attached to a message (abandoned composer, crashed tab).
create or replace function public.list_orphan_uploads(p_older_than_hours integer default 24, p_limit integer default 200)
returns table (path text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'attachments'
    and o.created_at < now() - make_interval(hours => greatest(coalesce(p_older_than_hours, 24), 1))
    and not exists (select 1 from public.attachments a where a.storage_path = o.name)
  order by o.created_at
  limit least(greatest(coalesce(p_limit, 200), 1), 1000);
$$;

-- Function privileges are managed centrally in 20261013120900_privileges.sql.
