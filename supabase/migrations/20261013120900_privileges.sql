-- KJ Chat: function privileges (single source of truth)
--
-- Supabase grants EXECUTE on new functions to anon/authenticated by default, and PostgreSQL
-- grants it to PUBLIC. Everything is revoked here and re-granted explicitly.
-- CONVENTION: any migration that adds a function must also update the grants below.

revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;

-- Anonymous visitors (registration page)
grant execute on function
  public.get_registration_mode(),
  public.validate_app_invite(text)
to anon, authenticated;

-- Signed-in users. Each function derives the acting user from auth.uid().
grant execute on function
  public.is_username_available(text),
  public.search_profiles(text, integer),
  public.touch_last_seen(),
  public.get_or_create_direct_conversation(uuid),
  public.get_conversations(),
  public.clear_conversation(uuid),
  public.get_messages(uuid, uuid, integer),
  public.get_messages_by_ids(uuid[]),
  public.search_messages(text, uuid, integer),
  public.edit_message(uuid, text),
  public.delete_message(uuid, boolean),
  public.toggle_reaction(uuid, text),
  public.mark_conversation_read(uuid, uuid),
  public.mark_delivered(),
  public.pin_message(uuid),
  public.unpin_message(uuid),
  public.report_content(uuid, uuid, text, text),
  public.register_push_subscription(text, text, text, text),
  public.create_group(text, text, uuid[]),
  public.update_group(uuid, text, text),
  public.set_group_avatar(uuid, text),
  public.add_group_members(uuid, uuid[]),
  public.remove_group_member(uuid, uuid),
  public.set_group_member_role(uuid, uuid, text),
  public.leave_group(uuid),
  public.delete_group(uuid),
  public.create_group_invite(uuid, integer, integer),
  public.revoke_group_invite(uuid),
  public.get_group_invite_preview(text),
  public.join_group_via_invite(text),
  public.admin_set_registration_mode(text),
  public.admin_create_app_invitation(text, text, integer, integer),
  public.admin_revoke_app_invitation(uuid),
  public.admin_update_report(uuid, text),
  public.admin_set_app_admin(uuid, boolean)
to authenticated;

-- Server only (Next.js route handlers holding the secret key, after verifying the session).
-- These accept a user id parameter, so they must never be callable by end users.
grant execute on function
  public.send_message(uuid, uuid, uuid, text, uuid, jsonb, boolean),
  public.start_call(uuid, uuid, text),
  public.join_call(uuid, uuid),
  public.decline_call(uuid, uuid),
  public.leave_call(uuid, uuid),
  public.can_moderate_call(uuid, uuid),
  public.livekit_participant_left(text, text),
  public.livekit_room_finished(text),
  public.prepare_account_deletion(uuid),
  public.check_rate_limit(text, integer, integer),
  public.dequeue_storage_deletions(integer),
  public.requeue_storage_deletions(jsonb),
  public.run_maintenance(),
  public.list_orphan_uploads(integer, integer)
to service_role;

-- Predicates evaluated inside RLS / storage / realtime policies run as the requesting role.
grant execute on function
  private.try_uuid(text),
  private.escape_like(text),
  private.is_member(uuid),
  private.is_group_admin(uuid),
  private.is_app_admin(),
  private.can_see_last_seen(uuid),
  private.can_upload_attachment(text),
  private.can_read_attachment(text),
  private.is_attachment_referenced(text),
  private.can_read_avatar(text),
  private.can_write_avatar(text),
  private.can_access_realtime_topic(text, boolean)
to authenticated, service_role;
