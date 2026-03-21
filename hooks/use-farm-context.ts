"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Farm, GrowerPortalContext } from "@/types/modules";

interface UseFarmContextReturn {
  farms: Farm[];
  selectedFarmId: string | null;
  setSelectedFarmId: (id: string | null) => void;
  showFarmSwitcher: boolean;
  isConsolidated: boolean;
  loading: boolean;
}

export function useFarmContext(
  portalContext: GrowerPortalContext
): UseFarmContextReturn {
  const [farms, setFarms] = useState<Farm[]>([]);
  const [selectedFarmId, setSelectedFarmId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const { growerId, farmIds, moduleRole } = portalContext;

  useEffect(() => {
    if (!growerId) {
      setLoading(false);
      return;
    }

    async function fetchFarms() {
      const supabase = createClient();
      let query = supabase
        .from("farms")
        .select("*")
        .eq("grower_id", growerId!)
        .eq("active", true)
        .order("name");

      // If user has specific farm_ids, filter to those
      if (farmIds && farmIds.length > 0) {
        query = query.in("id", farmIds);
      }

      const { data } = await query;
      const farmList = (data ?? []) as Farm[];
      setFarms(farmList);

      // If only one farm, lock to it
      if (farmList.length === 1) {
        setSelectedFarmId(farmList[0].id);
      }

      setLoading(false);
    }

    fetchFarms();
  }, [growerId, farmIds]);

  // Admin/staff can view all growers — no farm context needed if no growerId
  const showFarmSwitcher = farms.length > 1;
  const isConsolidated = selectedFarmId === null && farms.length > 1;

  return {
    farms,
    selectedFarmId: farms.length === 1 ? farms[0]?.id ?? null : selectedFarmId,
    setSelectedFarmId: farms.length === 1 ? () => {} : setSelectedFarmId,
    showFarmSwitcher,
    isConsolidated,
    loading,
  };
}
