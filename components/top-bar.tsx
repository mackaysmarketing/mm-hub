import type { ReactNode } from "react";

interface TopBarProps {
  title: string;
  children?: ReactNode;
}

export function TopBar({ title, children }: TopBarProps) {
  return (
    <div className="flex h-16 items-center justify-between border-b border-sand bg-warmwhite px-6">
      <h1 className="text-lg font-semibold text-soil">{title}</h1>
      {children && <div className="flex items-center gap-3">{children}</div>}
    </div>
  );
}
