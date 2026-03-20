"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { UserSession } from "@/types/modules";

export function useUser() {
  const [session, setSession] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const supabase = createClient();

  async function fetchSession() {
    try {
      setLoading(true);
      setError(null);

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setSession(null);
        return;
      }

      const { data: hubUser, error: hubError } = await supabase
        .from("hub_users")
        .select("*")
        .eq("id", user.id)
        .single();

      if (hubError || !hubUser || !hubUser.active) {
        setSession(null);
        return;
      }

      const { data: moduleRows, error: modError } = await supabase
        .from("module_access")
        .select("*")
        .eq("user_id", user.id)
        .eq("active", true);

      if (modError) {
        throw modError;
      }

      setSession({
        hubUser: {
          id: hubUser.id,
          name: hubUser.name,
          email: hubUser.email,
          hub_role: hubUser.hub_role,
          auth_provider: hubUser.auth_provider,
          active: hubUser.active,
          last_login_at: hubUser.last_login_at,
          created_at: hubUser.created_at,
        },
        moduleAccess: (moduleRows || []).map((r) => ({
          id: r.id,
          user_id: r.user_id,
          module_id: r.module_id,
          module_role: r.module_role,
          config: r.config || {},
          active: r.active,
          granted_by: r.granted_by,
          created_at: r.created_at,
          updated_at: r.updated_at,
        })),
      });
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to fetch user session"));
      setSession(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      fetchSession();
    });

    return () => {
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { session, loading, error };
}
