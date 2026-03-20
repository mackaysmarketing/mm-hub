import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getUserSession } from "@/lib/auth";
import { getPortalMode } from "@/lib/subdomain";
import { MODULES } from "@/lib/modules";
import type { ModuleId } from "@/types/modules";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getUserSession();

  if (!session) {
    redirect("/login");
  }

  // Detect portal mode from middleware header
  const headersList = headers();
  const hostname = headersList.get("host") || "localhost";
  const mode = getPortalMode(hostname);

  const isHubAdmin = session.hubUser.hub_role === "hub_admin";
  const modules = session.moduleAccess;

  // Grower mode: always go to grower portal dashboard
  if (mode === "grower") {
    redirect("/dashboard");
  }

  // Hub / dev mode: existing multi-module routing logic
  if (modules.length === 0 && !isHubAdmin) {
    redirect("/no-access");
  }

  if (modules.length === 1 && !isHubAdmin) {
    const mod = MODULES[modules[0].module_id as ModuleId];
    if (mod) {
      redirect(mod.defaultPath);
    }
  }

  // Multi-module or hub_admin: redirect to first module's default path
  if (modules.length > 0) {
    const firstMod = MODULES[modules[0].module_id as ModuleId];
    if (firstMod) {
      redirect(firstMod.defaultPath);
    }
  }

  // Hub admin with no module_access rows — go to hub admin
  redirect("/dashboard");
}
