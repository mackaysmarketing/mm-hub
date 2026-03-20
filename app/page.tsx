import { redirect } from "next/navigation";
import { getUserSession } from "@/lib/auth";
import { MODULES } from "@/lib/modules";
import type { ModuleId } from "@/types/modules";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getUserSession();

  if (!session) {
    redirect("/login");
  }

  const isHubAdmin = session.hubUser.hub_role === "hub_admin";
  const modules = session.moduleAccess;

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
