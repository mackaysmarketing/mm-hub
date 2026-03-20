import Image from "next/image";
import { cn } from "@/lib/utils";

interface MackaysLogoProps {
  /** Width of the logo in pixels. Height auto-scales to maintain aspect ratio. */
  width?: number;
  className?: string;
}

/**
 * Mackays Marketing logo.
 * Requires: public/logo-mackays.png
 *
 * Sizes used across the app:
 * - Sidebar header: width={140}
 * - Login page: width={200}
 * - 404 / error pages: width={160}
 * - Loading screen: width={120}
 */
export function MackaysLogo({ width = 160, className }: MackaysLogoProps) {
  return (
    <Image
      src="/logo-mackays.png"
      alt="Mackays Marketing"
      width={width}
      height={Math.round(width * 0.48)}
      className={cn("h-auto", className)}
      priority
    />
  );
}
