"use client";

import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { isPublicProviderPath } from "@/lib/public-provider-paths";

// Keep Firebase's module initialization out of public share/preference pages.
const WorkspaceProviders = dynamic(() => import("./workspace-providers").then(module => module.WorkspaceProviders));

export function RootProviders({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (isPublicProviderPath(pathname)) {
    return <>{children}</>;
  }

  return <WorkspaceProviders>{children}</WorkspaceProviders>;
}
