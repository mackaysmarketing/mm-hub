"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import type { GrowerPortalContext } from "@/types/modules";

interface GrowerInfo {
  id: string;
  name: string;
  code: string | null;
}

interface UseGrowerContextReturn {
  growers: GrowerInfo[];
  selectedGrowerId: string | null;
  setSelectedGrowerId: (id: string | null) => void;
  showGrowerSwitcher: boolean;
  isConsolidated: boolean;
  loading: boolean;
}

const STORAGE_PREFIX = "mm-hub:selected-farm:";

/**
 * Loads the farms (rows in `growers` table) the caller can see for the current
 * group, persists the selected farm across navigations/reloads, and exposes the
 * standard pieces the portal shell + every data route need.
 *
 * Behaviour (matches the operator's spec):
 *   * fetch from RLS-scoped `growers` table (not the API to avoid an extra hop)
 *   * if exactly 1 farm: lock the selection to it; switcher hidden
 *   * if >1: default to "All Farms" (null), persist any explicit choice in
 *     localStorage keyed by grower_group_id so groups don't leak selections
 *     into each other
 */
export function useGrowerContext(
  portalContext: GrowerPortalContext
): UseGrowerContextReturn {
  const [growers, setGrowers] = useState<GrowerInfo[]>([]);
  const [selectedGrowerId, setSelectedGrowerIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const { growerGroupId, growerIds } = portalContext;

  useEffect(() => {
    if (!growerGroupId) {
      setLoading(false);
      return;
    }

    async function fetchGrowers() {
      const supabase = createClient();
      let query = supabase
        .from("farms")
        .select("id, name, code")
        .eq("grower_group_id", growerGroupId!)
        .eq("active", true)
        .order("name");

      if (growerIds && growerIds.length > 0) {
        query = query.in("id", growerIds);
      }

      const { data } = await query;
      const growerList = (data ?? []) as GrowerInfo[];
      setGrowers(growerList);

      // Single farm → lock to it. Multiple → restore persisted choice if still
      // valid, else default to "All Farms" (null).
      if (growerList.length === 1) {
        setSelectedGrowerIdState(growerList[0].id);
      } else if (typeof window !== "undefined") {
        const saved = window.localStorage.getItem(STORAGE_PREFIX + growerGroupId);
        if (saved && growerList.some((g) => g.id === saved)) {
          setSelectedGrowerIdState(saved);
        } else {
          setSelectedGrowerIdState(null); // "All Farms" default
        }
      }

      setLoading(false);
    }

    fetchGrowers();
  }, [growerGroupId, growerIds]);

  // Wrap setter to persist; single-farm callers are no-ops (selection is fixed).
  const setSelectedGrowerId = (id: string | null) => {
    if (growers.length === 1) return;
    setSelectedGrowerIdState(id);
    if (typeof window !== "undefined" && growerGroupId) {
      const key = STORAGE_PREFIX + growerGroupId;
      if (id) window.localStorage.setItem(key, id);
      else window.localStorage.removeItem(key);
    }
  };

  const showGrowerSwitcher = growers.length > 1;
  const isConsolidated = selectedGrowerId === null && growers.length > 1;

  return {
    growers,
    selectedGrowerId:
      growers.length === 1 ? growers[0]?.id ?? null : selectedGrowerId,
    setSelectedGrowerId,
    showGrowerSwitcher,
    isConsolidated,
    loading,
  };
}
