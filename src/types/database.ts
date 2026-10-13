/**
 * Database types for the KJ Chat schema, in the format produced by `supabase gen types typescript`.
 *
 * Maintained by hand to match supabase/migrations (the Supabase CLI could not be installed in the
 * environment this was written in). Regenerate with `npm run db:types` against a local stack and
 * diff the result whenever a migration changes.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Timestamp = string;

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "12";
  };
  public: {
    Tables: {
      app_settings: {
        Row: { id: boolean; registration_mode: "open" | "invite"; updated_at: Timestamp };
        Insert: { id?: boolean; registration_mode?: "open" | "invite"; updated_at?: Timestamp };
        Update: { id?: boolean; registration_mode?: "open" | "invite"; updated_at?: Timestamp };
        Relationships: [];
      };
      app_admins: {
        Row: { user_id: string; created_at: Timestamp };
        Insert: { user_id: string; created_at?: Timestamp };
        Update: { user_id?: string; created_at?: Timestamp };
        Relationships: [
          {
            foreignKeyName: "app_admins_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      app_invitations: {
        Row: {
          id: string;
          code: string;
          email: string | null;
          note: string | null;
          created_by: string | null;
          expires_at: Timestamp | null;
          max_uses: number;
          use_count: number;
          revoked_at: Timestamp | null;
          created_at: Timestamp;
        };
        Insert: {
          id?: string;
          code?: string;
          email?: string | null;
          note?: string | null;
          created_by?: string | null;
          expires_at?: Timestamp | null;
          max_uses?: number;
          use_count?: number;
          revoked_at?: Timestamp | null;
          created_at?: Timestamp;
        };
        Update: Partial<Database["public"]["Tables"]["app_invitations"]["Insert"]>;
        Relationships: [];
      };
      app_invitation_uses: {
        Row: { invitation_id: string; user_id: string; used_at: Timestamp };
        Insert: { invitation_id: string; user_id: string; used_at?: Timestamp };
        Update: { invitation_id?: string; user_id?: string; used_at?: Timestamp };
        Relationships: [
          {
            foreignKeyName: "app_invitation_uses_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          id: string;
          username: string | null;
          display_name: string;
          avatar_path: string | null;
          bio: string | null;
          status_text: string | null;
          created_at: Timestamp;
          updated_at: Timestamp;
        };
        Insert: {
          id: string;
          username?: string | null;
          display_name: string;
          avatar_path?: string | null;
          bio?: string | null;
          status_text?: string | null;
          created_at?: Timestamp;
          updated_at?: Timestamp;
        };
        Update: {
          username?: string | null;
          display_name?: string;
          avatar_path?: string | null;
          bio?: string | null;
          status_text?: string | null;
        };
        Relationships: [];
      };
      user_settings: {
        Row: {
          user_id: string;
          last_seen_visibility: "everyone" | "contacts" | "nobody";
          show_online_status: boolean;
          read_receipts_enabled: boolean;
          notify_messages: boolean;
          notify_calls: boolean;
          notification_previews: boolean;
          notification_sound: boolean;
          quiet_hours_enabled: boolean;
          quiet_hours_start: string;
          quiet_hours_end: string;
          timezone: string;
          updated_at: Timestamp;
        };
        Insert: {
          user_id: string;
          last_seen_visibility?: "everyone" | "contacts" | "nobody";
          show_online_status?: boolean;
          read_receipts_enabled?: boolean;
          notify_messages?: boolean;
          notify_calls?: boolean;
          notification_previews?: boolean;
          notification_sound?: boolean;
          quiet_hours_enabled?: boolean;
          quiet_hours_start?: string;
          quiet_hours_end?: string;
          timezone?: string;
          updated_at?: Timestamp;
        };
        Update: Partial<Omit<Database["public"]["Tables"]["user_settings"]["Insert"], "user_id">>;
        Relationships: [];
      };
      user_last_seen: {
        Row: { user_id: string; last_seen_at: Timestamp };
        Insert: { user_id: string; last_seen_at?: Timestamp };
        Update: { last_seen_at?: Timestamp };
        Relationships: [];
      };
      user_blocks: {
        Row: { blocker_id: string; blocked_id: string; created_at: Timestamp };
        Insert: { blocker_id: string; blocked_id: string; created_at?: Timestamp };
        Update: { blocker_id?: string; blocked_id?: string; created_at?: Timestamp };
        Relationships: [
          {
            foreignKeyName: "user_blocks_blocked_id_fkey";
            columns: ["blocked_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_blocks_blocker_id_fkey";
            columns: ["blocker_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      conversations: {
        Row: {
          id: string;
          type: "direct" | "group";
          name: string | null;
          description: string | null;
          avatar_path: string | null;
          direct_key: string | null;
          created_by: string | null;
          last_message_at: Timestamp | null;
          created_at: Timestamp;
          updated_at: Timestamp;
        };
        Insert: {
          id?: string;
          type: "direct" | "group";
          name?: string | null;
          description?: string | null;
          avatar_path?: string | null;
          direct_key?: string | null;
          created_by?: string | null;
          last_message_at?: Timestamp | null;
          created_at?: Timestamp;
          updated_at?: Timestamp;
        };
        Update: Partial<Database["public"]["Tables"]["conversations"]["Insert"]>;
        Relationships: [];
      };
      conversation_members: {
        Row: {
          conversation_id: string;
          user_id: string;
          role: "owner" | "admin" | "member";
          joined_at: Timestamp;
          added_by: string | null;
          last_read_at: Timestamp | null;
          last_delivered_at: Timestamp | null;
        };
        Insert: {
          conversation_id: string;
          user_id: string;
          role?: "owner" | "admin" | "member";
          joined_at?: Timestamp;
          added_by?: string | null;
          last_read_at?: Timestamp | null;
          last_delivered_at?: Timestamp | null;
        };
        Update: Partial<Database["public"]["Tables"]["conversation_members"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "conversation_members_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversation_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversation_members_added_by_fkey";
            columns: ["added_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      conversation_preferences: {
        Row: {
          conversation_id: string;
          user_id: string;
          last_read_at: Timestamp | null;
          muted_until: Timestamp | null;
          archived_at: Timestamp | null;
          pinned_at: Timestamp | null;
          cleared_at: Timestamp | null;
          notification_level: "all" | "mentions" | "none";
        };
        Insert: {
          conversation_id: string;
          user_id: string;
          last_read_at?: Timestamp | null;
          muted_until?: Timestamp | null;
          archived_at?: Timestamp | null;
          pinned_at?: Timestamp | null;
          cleared_at?: Timestamp | null;
          notification_level?: "all" | "mentions" | "none";
        };
        Update: {
          muted_until?: Timestamp | null;
          archived_at?: Timestamp | null;
          pinned_at?: Timestamp | null;
          notification_level?: "all" | "mentions" | "none";
        };
        Relationships: [];
      };
      messages: {
        Row: {
          id: string;
          conversation_id: string;
          sender_id: string | null;
          client_id: string | null;
          message_type: MessageType;
          content: string | null;
          metadata: Json;
          reply_to_message_id: string | null;
          is_forwarded: boolean;
          created_at: Timestamp;
          updated_at: Timestamp;
          edited_at: Timestamp | null;
          deleted_at: Timestamp | null;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          sender_id?: string | null;
          client_id?: string | null;
          message_type?: MessageType;
          content?: string | null;
          metadata?: Json;
          reply_to_message_id?: string | null;
          is_forwarded?: boolean;
          created_at?: Timestamp;
          updated_at?: Timestamp;
          edited_at?: Timestamp | null;
          deleted_at?: Timestamp | null;
        };
        Update: Partial<Database["public"]["Tables"]["messages"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_sender_id_fkey";
            columns: ["sender_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      attachments: {
        Row: {
          id: string;
          message_id: string;
          conversation_id: string;
          uploader_id: string | null;
          storage_path: string;
          file_name: string;
          mime_type: string;
          file_size: number;
          kind: AttachmentKind;
          width: number | null;
          height: number | null;
          duration_ms: number | null;
          waveform: Json | null;
          created_at: Timestamp;
        };
        Insert: {
          id?: string;
          message_id: string;
          conversation_id: string;
          uploader_id?: string | null;
          storage_path: string;
          file_name: string;
          mime_type: string;
          file_size: number;
          kind: AttachmentKind;
          width?: number | null;
          height?: number | null;
          duration_ms?: number | null;
          waveform?: Json | null;
          created_at?: Timestamp;
        };
        Update: Partial<Database["public"]["Tables"]["attachments"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "attachments_message_id_fkey";
            columns: ["message_id"];
            isOneToOne: false;
            referencedRelation: "messages";
            referencedColumns: ["id"];
          },
        ];
      };
      message_reactions: {
        Row: { id: string; message_id: string; conversation_id: string; user_id: string; emoji: string; created_at: Timestamp };
        Insert: { id?: string; message_id: string; conversation_id: string; user_id: string; emoji: string; created_at?: Timestamp };
        Update: Partial<Database["public"]["Tables"]["message_reactions"]["Insert"]>;
        Relationships: [];
      };
      message_hidden: {
        Row: { user_id: string; message_id: string; created_at: Timestamp };
        Insert: { user_id: string; message_id: string; created_at?: Timestamp };
        Update: { user_id?: string; message_id?: string; created_at?: Timestamp };
        Relationships: [];
      };
      message_mentions: {
        Row: { message_id: string; user_id: string; conversation_id: string };
        Insert: { message_id: string; user_id: string; conversation_id: string };
        Update: { message_id?: string; user_id?: string; conversation_id?: string };
        Relationships: [];
      };
      pinned_messages: {
        Row: { conversation_id: string; message_id: string; pinned_by: string | null; pinned_at: Timestamp };
        Insert: { conversation_id: string; message_id: string; pinned_by?: string | null; pinned_at?: Timestamp };
        Update: Partial<Database["public"]["Tables"]["pinned_messages"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "pinned_messages_message_id_fkey";
            columns: ["message_id"];
            isOneToOne: false;
            referencedRelation: "messages";
            referencedColumns: ["id"];
          },
        ];
      };
      user_reports: {
        Row: {
          id: string;
          reporter_id: string;
          reported_user_id: string | null;
          message_id: string | null;
          reason: ReportReason;
          details: string | null;
          status: "open" | "reviewed" | "dismissed";
          created_at: Timestamp;
          reviewed_by: string | null;
          reviewed_at: Timestamp | null;
        };
        Insert: {
          id?: string;
          reporter_id: string;
          reported_user_id?: string | null;
          message_id?: string | null;
          reason: ReportReason;
          details?: string | null;
          status?: "open" | "reviewed" | "dismissed";
          created_at?: Timestamp;
          reviewed_by?: string | null;
          reviewed_at?: Timestamp | null;
        };
        Update: Partial<Database["public"]["Tables"]["user_reports"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "user_reports_reporter_id_fkey";
            columns: ["reporter_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_reports_reported_user_id_fkey";
            columns: ["reported_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      group_invites: {
        Row: {
          id: string;
          conversation_id: string;
          token: string;
          created_by: string | null;
          expires_at: Timestamp;
          max_uses: number | null;
          use_count: number;
          revoked_at: Timestamp | null;
          created_at: Timestamp;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          token?: string;
          created_by?: string | null;
          expires_at: Timestamp;
          max_uses?: number | null;
          use_count?: number;
          revoked_at?: Timestamp | null;
          created_at?: Timestamp;
        };
        Update: Partial<Database["public"]["Tables"]["group_invites"]["Insert"]>;
        Relationships: [];
      };
      call_sessions: {
        Row: CallSessionRow;
        Insert: {
          id?: string;
          conversation_id: string;
          room_name: string;
          media_type: "audio" | "video";
          started_by?: string | null;
          status?: CallStatus;
          end_reason?: CallEndReason | null;
          created_at?: Timestamp;
          ring_expires_at?: Timestamp;
          answered_at?: Timestamp | null;
          ended_at?: Timestamp | null;
        };
        Update: Partial<Database["public"]["Tables"]["call_sessions"]["Insert"]>;
        Relationships: [];
      };
      call_participants: {
        Row: {
          call_id: string;
          user_id: string;
          conversation_id: string;
          status: CallParticipantStatus;
          invited_at: Timestamp;
          joined_at: Timestamp | null;
          left_at: Timestamp | null;
        };
        Insert: {
          call_id: string;
          user_id: string;
          conversation_id: string;
          status: CallParticipantStatus;
          invited_at?: Timestamp;
          joined_at?: Timestamp | null;
          left_at?: Timestamp | null;
        };
        Update: Partial<Database["public"]["Tables"]["call_participants"]["Insert"]>;
        Relationships: [];
      };
      push_subscriptions: {
        Row: {
          id: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent: string | null;
          created_at: Timestamp;
          last_used_at: Timestamp | null;
          failure_count: number;
        };
        Insert: {
          id?: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent?: string | null;
          created_at?: Timestamp;
          last_used_at?: Timestamp | null;
          failure_count?: number;
        };
        Update: Partial<Database["public"]["Tables"]["push_subscriptions"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: {
      message_details: {
        Row: MessageDetailsRow;
        Relationships: [];
      };
    };
    Functions: {
      get_registration_mode: { Args: never; Returns: "open" | "invite" };
      validate_app_invite: { Args: { p_code: string }; Returns: boolean };
      is_username_available: { Args: { p_username: string }; Returns: boolean };
      search_profiles: {
        Args: { p_query: string; p_limit?: number };
        Returns: {
          id: string;
          username: string;
          display_name: string;
          avatar_path: string | null;
          status_text: string | null;
          is_blocked: boolean;
        }[];
      };
      touch_last_seen: { Args: never; Returns: undefined };
      get_or_create_direct_conversation: { Args: { p_other_user_id: string }; Returns: string };
      get_conversations: { Args: never; Returns: ConversationSummaryRow[] };
      clear_conversation: { Args: { p_conversation_id: string }; Returns: undefined };
      get_messages: {
        Args: { p_conversation_id: string; p_before_id?: string; p_limit?: number };
        Returns: MessageDetailsRow[];
      };
      get_messages_by_ids: { Args: { p_ids: string[] }; Returns: MessageDetailsRow[] };
      search_messages: {
        Args: { p_query: string; p_conversation_id?: string; p_limit?: number };
        Returns: {
          id: string;
          conversation_id: string;
          sender_id: string | null;
          message_type: MessageType;
          content: string | null;
          created_at: Timestamp;
        }[];
      };
      send_message: {
        Args: {
          p_sender_id: string;
          p_conversation_id: string;
          p_client_id: string;
          p_content?: string | null;
          p_reply_to_message_id?: string | null;
          p_attachments?: Json;
          p_is_forwarded?: boolean;
        };
        Returns: Database["public"]["Tables"]["messages"]["Row"];
      };
      edit_message: {
        Args: { p_message_id: string; p_content: string | null };
        Returns: Database["public"]["Tables"]["messages"]["Row"];
      };
      delete_message: { Args: { p_message_id: string; p_for_everyone?: boolean }; Returns: undefined };
      toggle_reaction: { Args: { p_message_id: string; p_emoji: string }; Returns: boolean };
      mark_conversation_read: { Args: { p_conversation_id: string; p_message_id?: string }; Returns: undefined };
      mark_delivered: { Args: never; Returns: undefined };
      pin_message: { Args: { p_message_id: string }; Returns: undefined };
      unpin_message: { Args: { p_message_id: string }; Returns: undefined };
      report_content: {
        Args: { p_reported_user_id: string | null; p_message_id: string | null; p_reason: ReportReason; p_details?: string | null };
        Returns: string;
      };
      register_push_subscription: {
        Args: { p_endpoint: string; p_p256dh: string; p_auth: string; p_user_agent?: string | null };
        Returns: string;
      };
      create_group: { Args: { p_name: string; p_description?: string | null; p_member_ids?: string[] }; Returns: string };
      update_group: { Args: { p_conversation_id: string; p_name: string; p_description: string | null }; Returns: undefined };
      set_group_avatar: { Args: { p_conversation_id: string; p_avatar_path: string | null }; Returns: undefined };
      add_group_members: { Args: { p_conversation_id: string; p_user_ids: string[] }; Returns: number };
      remove_group_member: { Args: { p_conversation_id: string; p_user_id: string }; Returns: undefined };
      set_group_member_role: {
        Args: { p_conversation_id: string; p_user_id: string; p_role: "owner" | "admin" | "member" };
        Returns: undefined;
      };
      leave_group: { Args: { p_conversation_id: string }; Returns: undefined };
      delete_group: { Args: { p_conversation_id: string }; Returns: string[] };
      create_group_invite: {
        Args: { p_conversation_id: string; p_expires_in_hours?: number; p_max_uses?: number | null };
        Returns: Database["public"]["Tables"]["group_invites"]["Row"];
      };
      revoke_group_invite: { Args: { p_invite_id: string }; Returns: undefined };
      get_group_invite_preview: {
        Args: { p_token: string };
        Returns: {
          conversation_id: string;
          name: string;
          description: string | null;
          member_count: number;
          is_member: boolean;
          expires_at: Timestamp;
        }[];
      };
      join_group_via_invite: { Args: { p_token: string }; Returns: string };
      start_call: {
        Args: { p_user_id: string; p_conversation_id: string; p_media_type: "audio" | "video" };
        Returns: Json;
      };
      join_call: { Args: { p_user_id: string; p_call_id: string }; Returns: CallSessionRow };
      decline_call: { Args: { p_user_id: string; p_call_id: string }; Returns: CallSessionRow };
      leave_call: { Args: { p_user_id: string; p_call_id: string }; Returns: CallSessionRow };
      can_moderate_call: { Args: { p_user_id: string; p_call_id: string }; Returns: boolean };
      livekit_participant_left: { Args: { p_room_name: string; p_identity: string }; Returns: undefined };
      livekit_room_finished: { Args: { p_room_name: string }; Returns: undefined };
      admin_set_registration_mode: { Args: { p_mode: "open" | "invite" }; Returns: undefined };
      admin_create_app_invitation: {
        Args: { p_email?: string | null; p_note?: string | null; p_expires_in_hours?: number | null; p_max_uses?: number };
        Returns: Database["public"]["Tables"]["app_invitations"]["Row"];
      };
      admin_revoke_app_invitation: { Args: { p_invitation_id: string }; Returns: undefined };
      admin_update_report: { Args: { p_report_id: string; p_status: "open" | "reviewed" | "dismissed" }; Returns: undefined };
      admin_set_app_admin: { Args: { p_user_id: string; p_is_admin: boolean }; Returns: undefined };
      prepare_account_deletion: { Args: { p_user_id: string }; Returns: undefined };
      check_rate_limit: { Args: { p_key: string; p_max: number; p_window_seconds: number }; Returns: boolean };
      dequeue_storage_deletions: {
        Args: { p_limit?: number };
        Returns: { id: number; bucket_id: string; path: string }[];
      };
      requeue_storage_deletions: { Args: { p_items: Json }; Returns: undefined };
      run_maintenance: { Args: never; Returns: Json };
      list_orphan_uploads: { Args: { p_older_than_hours?: number; p_limit?: number }; Returns: { path: string }[] };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type MessageType = "text" | "image" | "video" | "audio" | "voice" | "file" | "system" | "call";
export type AttachmentKind = "image" | "video" | "audio" | "voice" | "file";
export type ReportReason = "spam" | "harassment" | "inappropriate" | "impersonation" | "other";
export type CallStatus = "ringing" | "active" | "ended";
export type CallEndReason = "completed" | "missed" | "declined" | "cancelled" | "busy" | "failed";
export type CallParticipantStatus = "invited" | "joined" | "left" | "declined" | "missed" | "busy";

export type CallSessionRow = {
  id: string;
  conversation_id: string;
  room_name: string;
  media_type: "audio" | "video";
  started_by: string | null;
  status: CallStatus;
  end_reason: CallEndReason | null;
  created_at: Timestamp;
  ring_expires_at: Timestamp;
  answered_at: Timestamp | null;
  ended_at: Timestamp | null;
};

export type MessageDetailsRow = Database["public"]["Tables"]["messages"]["Row"] & {
  attachments: Json;
  reactions: Json;
  reply_to: Json | null;
};

export type ConversationSummaryRow = {
  id: string;
  type: "direct" | "group";
  name: string | null;
  description: string | null;
  avatar_path: string | null;
  created_at: Timestamp;
  last_message_at: Timestamp | null;
  my_role: "owner" | "admin" | "member";
  member_count: number;
  peer: Json | null;
  last_message: Json | null;
  unread_count: number;
  mention_count: number;
  muted_until: Timestamp | null;
  archived_at: Timestamp | null;
  pinned_at: Timestamp | null;
  notification_level: "all" | "mentions" | "none";
  cleared_at: Timestamp | null;
  last_read_at: Timestamp | null;
  active_call: Json | null;
};

export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
