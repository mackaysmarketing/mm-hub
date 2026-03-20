export type PortalMode = "grower" | "hub" | "dev";

export function getPortalMode(hostname: string): PortalMode {
  // Strip port for comparison
  const host = hostname.split(":")[0].toLowerCase();

  // Production subdomains
  if (host.startsWith("grower.") || host.startsWith("growers.")) return "grower";
  if (host.startsWith("hub.") || host.startsWith("admin.")) return "hub";

  // Allow env var override for custom domains
  const growerDomain = process.env.NEXT_PUBLIC_GROWER_DOMAIN;
  const hubDomain = process.env.NEXT_PUBLIC_HUB_DOMAIN;
  if (growerDomain && host === growerDomain.toLowerCase()) return "grower";
  if (hubDomain && host === hubDomain.toLowerCase()) return "hub";

  // Localhost / development = show everything
  return "dev";
}

/** What auth methods are allowed per mode */
export function getAllowedAuthMethods(mode: PortalMode) {
  switch (mode) {
    case "grower":
      return { email: true, microsoft: false };
    case "hub":
      return { email: false, microsoft: true };
    case "dev":
      return { email: true, microsoft: true };
  }
}

/** What modules are accessible per mode */
export function getAllowedModules(mode: PortalMode): string[] | "all" {
  switch (mode) {
    case "grower":
      return ["grower-portal"];
    case "hub":
      return "all";
    case "dev":
      return "all";
  }
}
