"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo } from "react";
import type * as React from "react";
import { fromDatabaseError } from "@/lib/errors";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
type SettingsRow = Database["public"]["Tables"]["user_settings"]["Row"];

interface SessionContextValue {
  userId: string;
  email: string | null;
  isAdmin: boolean;
  profile: ProfileRow;
  settings: SettingsRow;
  updateProfile: (patch: Database["public"]["Tables"]["profiles"]["Update"]) => Promise<ProfileRow>;
  updateSettings: (patch: Database["public"]["Tables"]["user_settings"]["Update"]) => Promise<SettingsRow>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export const sessionKeys = {
  profile: ["me", "profile"] as const,
  settings: ["me", "settings"] as const,
};

export function SessionProvider({
  userId,
  email,
  isAdmin,
  initialProfile,
  initialSettings,
  children,
}: {
  userId: string;
  email: string | null;
  isAdmin: boolean;
  initialProfile: ProfileRow;
  initialSettings: SettingsRow;
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const supabase = getSupabaseBrowserClient();

  const profileQuery = useQuery({
    queryKey: sessionKeys.profile,
    initialData: initialProfile,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).single();
      if (error) throw fromDatabaseError(error);
      return data;
    },
  });

  const settingsQuery = useQuery({
    queryKey: sessionKeys.settings,
    initialData: initialSettings,
    queryFn: async () => {
      const { data, error } = await supabase.from("user_settings").select("*").eq("user_id", userId).single();
      if (error) throw fromDatabaseError(error);
      return data;
    },
  });

  const updateProfile = useCallback(
    async (patch: Database["public"]["Tables"]["profiles"]["Update"]) => {
      const { data, error } = await supabase.from("profiles").update(patch).eq("id", userId).select("*").single();
      if (error) throw fromDatabaseError(error, "Could not update your profile.");
      queryClient.setQueryData(sessionKeys.profile, data);
      return data;
    },
    [queryClient, supabase, userId],
  );

  const updateSettings = useCallback(
    async (patch: Database["public"]["Tables"]["user_settings"]["Update"]) => {
      const { data, error } = await supabase.from("user_settings").update(patch).eq("user_id", userId).select("*").single();
      if (error) throw fromDatabaseError(error, "Could not save your settings.");
      queryClient.setQueryData(sessionKeys.settings, data);
      return data;
    },
    [queryClient, supabase, userId],
  );

  const value = useMemo<SessionContextValue>(
    () => ({
      userId,
      email,
      isAdmin,
      profile: profileQuery.data,
      settings: settingsQuery.data,
      updateProfile,
      updateSettings,
    }),
    [userId, email, isAdmin, profileQuery.data, settingsQuery.data, updateProfile, updateSettings],
  );

  return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
