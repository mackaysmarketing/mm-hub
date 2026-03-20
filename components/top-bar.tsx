import type { ReactNode } from "react";

interface TopBarProps {
  title: string;
  children?: ReactNode;
  /** Slot for the mobile sidebar trigger — rendered before the title on mobile */
  sidebarTrigger?: ReactNode;
  /** Slot for right-aligned badge (e.g. data freshness) */
  badge?: ReactNode;
}

export function TopBar({ title, children, sidebarTrigger, badge }: TopBarProps) {
  return (
    <div className="flex h-16 items-center justify-between border-b border-sand bg-warmwhite px-4 sm:px-6">
      <div className="flex items-center gap-2">
        {sidebarTrigger}
        <h1 className="text-lg font-semibold text-soil">{title}</h1>
      </div>
      <div className="flex items-center gap-3">
        {badge}
        {children}
      </div>
    </div>
  );
}
