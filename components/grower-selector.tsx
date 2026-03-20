"use client";

import { ChevronDown, Sprout } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

interface Grower {
  id: string;
  name: string;
  code: string;
}

interface GrowerSelectorProps {
  growers: Grower[];
  selectedGrowerId: string | null;
  onSelect: (growerId: string | null) => void;
  disabled?: boolean;
}

export function GrowerSelector({
  growers,
  selectedGrowerId,
  onSelect,
  disabled = false,
}: GrowerSelectorProps) {
  const selectedGrower = growers.find((g) => g.id === selectedGrowerId);
  const displayLabel = selectedGrower
    ? selectedGrower.name
    : "All Growers";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          variant="outline"
          className="border-sand bg-warmwhite text-soil hover:bg-cream"
        >
          <Sprout size={16} className="mr-2 text-canopy" />
          <span className="max-w-[180px] truncate">{displayLabel}</span>
          <ChevronDown size={14} className="ml-2 text-clay" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="border-sand bg-warmwhite"
      >
        <DropdownMenuItem
          onClick={() => onSelect(null)}
          className="text-soil hover:bg-cream"
        >
          All Growers
        </DropdownMenuItem>
        {growers.map((grower) => (
          <DropdownMenuItem
            key={grower.id}
            onClick={() => onSelect(grower.id)}
            className="text-soil hover:bg-cream"
          >
            <span className="mr-2 text-xs text-clay">{grower.code}</span>
            {grower.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
