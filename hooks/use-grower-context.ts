"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import type { GrowerPortalContext } from "@/types/modules";

interface GrowerInfo {
  id: string;
  name: string;
  code: string | null;
  region: string | null;
}

interface UseGrowerContextReturn {
  growers: GrowerInfo[];
  selectedGrowerId: string | null;
  setSelectedGrowerId: (id: string | null) => void;
  showGrowerSwitcher: boolean;
  isConsolidated: boolean;
  loading: boolean;
}

export function useGrowerContext(
  portalContext: GrowerPortalContext
): UseGrowerContextReturn {
  const [growers, setGrowers] = useState<GrowerInfo[]>([]);
  const [selectedGrowerId, setSelectedGrowerId] = useState<string | null>(null);
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
        .from("growers")
        .select("id, name, code, region")
        .eq("grower_group_id", growerGroupId!)
        .eq("active", true)
        .order("name");

      // If user has specific grower_ids, filter to those
      if (growerIds && growerIds.length > 0) {
        query = query.in("id", growerIds);
      }

      const { data } = await query;
      const growerList = (data ?? []) as GrowerInfo[];
      setGrowers(growerList);

      // If only one grower, lock to it
      if (growerList.length === 1) {
        setSelectedGrowerId(growerList[0].id);
      }

      setLoading(false);
    }

    fetchGrowers();
  }, [growerGroupId, growerIds]);

  const showGrowerSwitcher = growers.length > 1;
  const isConsolidated = selectedGrowerId === null && growers.length > 1;

  return {
    growers,
    selectedGrowerId: growers.length === 1 ? growers[0]?.id ?? null : selectedGrowerId,
    setSelectedGrowerId: growers.length === 1 ? () => {} : setSelectedGrowerId,
    showGrowerSwitcher,
    isConsolidated,
    loading,
  };
}
