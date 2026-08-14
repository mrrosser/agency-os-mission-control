import Link from "next/link";
import { AfroGlyph } from "@/components/branding/AfroGlyph";
import { Button } from "@/components/ui/button";
import { GOOGLE_BUSINESS_PROFILES } from "@/lib/google/business-profiles";

export function GoogleWorkspaceSettingsNotice() {
  return (
    <div className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-cyan-500/10 p-2 text-cyan-300">
          <AfroGlyph variant="integrations" className="h-5 w-5" />
        </div>
        <div className="space-y-1">
          <p className="font-medium text-white">Google Workspace</p>
          <p className="text-sm text-zinc-400">
            Google access is connected per organization. Choose the intended workspace in
            Integrations so credentials never cross between profiles.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-xs text-zinc-300">
        {GOOGLE_BUSINESS_PROFILES.map((profile) => (
          <span
            key={profile.profileId}
            className="rounded-full border border-zinc-700 bg-black/40 px-2 py-1"
          >
            {profile.label}
          </span>
        ))}
      </div>

      <Button asChild className="w-full bg-white text-black hover:bg-zinc-200">
        <Link href="/dashboard/integrations">
          Manage Google connections
        </Link>
      </Button>
    </div>
  );
}
