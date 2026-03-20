"use client";

import { useState } from "react";
import type { GrowerPortalContext } from "@/types/modules";

export function useGrowerContext(portalContext: GrowerPortalContext) {
  const canViewAllGrowers = portalContext.capabilities.includes(
    "view_all_growers"
  );

  const [selectedGrowerId, setSelectedGrowerId] = useState<string | null>(
    portalContext.growerId
  );

  function handleSetSelectedGrowerId(growerId: string | null) {
    if (!canViewAllGrowers) return;
    setSelectedGrowerId(growerId);
  }

  return {
    selectedGrowerId: canViewAllGrowers
      ? selectedGrowerId
      : portalContext.growerId,
    setSelectedGrowerId: handleSetSelectedGrowerId,
    canViewAllGrowers,
  };
}
