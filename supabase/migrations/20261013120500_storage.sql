-- KJ Chat: private storage buckets and object policies
--
-- attachments/<conversation_id>/<uploader_id>/<uuid>/<file name>
--   upload: the uploader, into their own folder of a conversation they belong to
--           (and, for direct chats, only when neither side has blocked the other)
--   read:   the uploader, or members of the conversation once the object is attached
--           to a message (unattached uploads are never visible to others)
--   delete: the uploader, only while the object is not attached to a message;
--           attached objects are removed by the server when the message is deleted
--
-- avatars/users/<user_id>/<file>        read: any signed-in user  write: that user
-- avatars/groups/<conversation_id>/<file> read: group members      write: group admins
--
-- Both buckets are private: files are served through short-lived signed URLs only.
-- Size and MIME allow-lists are enforced by the Storage server per bucket; the app server
-- additionally content-sniffs attachments before they can be attached to a message.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'attachments', 'attachments', false, 52428800,
    array[
      'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'image/heic', 'image/heif',
      'video/mp4', 'video/webm', 'video/quicktime', 'video/ogg',
      'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg', 'audio/opus', 'audio/webm',
      'audio/wav', 'audio/x-wav', 'audio/flac',
      'application/pdf', 'text/plain', 'text/csv', 'application/rtf', 'application/zip',
      'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.oasis.opendocument.text', 'application/vnd.oasis.opendocument.spreadsheet',
      'application/vnd.oasis.opendocument.presentation'
    ]
  ),
  (
    'avatars', 'avatars', false, 5242880,
    array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  )
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.can_upload_attachment(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parts text[] := storage.foldername(p_name);
  v_conversation uuid;
  v_uid uuid := auth.uid();
  v_peer uuid;
begin
  if v_uid is null or coalesce(array_length(v_parts, 1), 0) <> 3 then
    return false;
  end if;

  v_conversation := private.try_uuid(v_parts[1]);
  if v_conversation is null or v_parts[2] <> v_uid::text or private.try_uuid(v_parts[3]) is null then
    return false;
  end if;

  if not private.is_user_member(v_conversation, v_uid) then
    return false;
  end if;

  if exists (select 1 from public.conversations c where c.id = v_conversation and c.type = 'direct') then
    v_peer := private.direct_peer(v_conversation, v_uid);
    if v_peer is null or private.is_blocked_between(v_uid, v_peer) then
      return false;
    end if;
  end if;

  return true;
end;
$$;

create or replace function private.can_read_attachment(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.attachments a
    join public.conversation_members m
      on m.conversation_id = a.conversation_id and m.user_id = (select auth.uid())
    where a.storage_path = p_name
  );
$$;

create or replace function private.is_attachment_referenced(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.attachments a where a.storage_path = p_name);
$$;

create or replace function private.can_read_avatar(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parts text[] := storage.foldername(p_name);
begin
  if auth.uid() is null or coalesce(array_length(v_parts, 1), 0) <> 2 then
    return false;
  end if;

  if v_parts[1] = 'users' then
    return true;
  end if;

  if v_parts[1] = 'groups' then
    return private.is_member(private.try_uuid(v_parts[2]));
  end if;

  return false;
end;
$$;

create or replace function private.can_write_avatar(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parts text[] := storage.foldername(p_name);
begin
  if auth.uid() is null or coalesce(array_length(v_parts, 1), 0) <> 2 then
    return false;
  end if;

  if v_parts[1] = 'users' then
    return v_parts[2] = auth.uid()::text;
  end if;

  if v_parts[1] = 'groups' then
    return private.is_group_admin(private.try_uuid(v_parts[2]));
  end if;

  return false;
end;
$$;

grant execute on function
  private.can_upload_attachment(text),
  private.can_read_attachment(text),
  private.is_attachment_referenced(text),
  private.can_read_avatar(text),
  private.can_write_avatar(text)
to authenticated, service_role;

create policy "kj attachments: upload into own conversation folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and private.can_upload_attachment(name));

create policy "kj attachments: uploader or conversation members read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and (owner_id = (select auth.uid())::text or private.can_read_attachment(name))
  );

create policy "kj attachments: uploader deletes unattached uploads"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'attachments'
    and owner_id = (select auth.uid())::text
    and not private.is_attachment_referenced(name)
  );

create policy "kj avatars: read"
  on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and private.can_read_avatar(name));

create policy "kj avatars: upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and private.can_write_avatar(name));

create policy "kj avatars: delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and private.can_write_avatar(name));
