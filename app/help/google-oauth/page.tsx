import Link from "next/link";
import { AfroGlyph } from "@/components/branding/AfroGlyph";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Google OAuth Verification | Mission Control",
  description: "Checklist to unblock Google Drive/Calendar/Gmail OAuth for external users.",
};

export default function GoogleOAuthHelpPage() {
  return (
    <main className="min-h-screen bg-black px-6 py-12 text-zinc-100">
      <div className="mx-auto w-full max-w-3xl space-y-8">
        <header className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="rounded-xl border border-white/10 bg-white/5 p-2">
              <AfroGlyph variant="integrations" className="h-6 w-6 text-cyan-300" />
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">Google OAuth Verification</h1>
          </div>
          <p className="text-sm text-zinc-400">
            Drive / Calendar / Gmail access can be blocked for external users until your OAuth consent screen is verified
            and your app is hosted on a domain you control (not <span className="text-zinc-200">web.app</span>).
          </p>
        </header>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
          <h2 className="text-lg font-semibold">Fastest path (small user count)</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-zinc-300">
            <li>
              In Google Auth Platform -&gt; Audience, add the user emails under <span className="text-zinc-100">Test users</span>.
            </li>
            <li>
              Have those users connect via Integrations -&gt; <span className="text-zinc-100">Connect Google (Drive + Calendar)</span>.
            </li>
            <li>
              Run the product while you complete the full verification + custom domain steps below.
            </li>
          </ol>
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
          <h2 className="text-lg font-semibold">Full verification checklist</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-zinc-300">
            <li>Buy a domain you control.</li>
            <li>Attach it as a Firebase Hosting custom domain and complete DNS verification.</li>
            <li>
              Ensure these pages are live on that domain:
              <div className="mt-2 flex flex-wrap gap-2">
                <Link href="/privacy">
                  <Button size="sm" variant="outline" className="border-zinc-700 bg-zinc-950 text-zinc-200 hover:text-white">
                    Privacy Policy
                  </Button>
                </Link>
                <Link href="/terms">
                  <Button size="sm" variant="outline" className="border-zinc-700 bg-zinc-950 text-zinc-200 hover:text-white">
                    Terms of Service
                  </Button>
                </Link>
              </div>
            </li>
            <li>
              Update the OAuth consent screen (Branding) to use your custom domain for:
              <span className="block mt-1 text-zinc-400">App home page, Privacy Policy URL, Terms URL, Authorized domains.</span>
            </li>
            <li>
              Update the OAuth client credential:
              <span className="block mt-1 text-zinc-400">
                Authorized origins + redirect URI <code className="text-zinc-200">/api/google/callback</code>.
              </span>
            </li>
            <li>Submit verification for the sensitive scopes you request (Drive/Calendar/Gmail).</li>
          </ol>
          <p className="mt-4 text-xs text-zinc-500">
            This page is a condensed checklist. The repo source of truth is <code className="text-zinc-300">docs/compliance/google-oauth-verification.md</code>.
          </p>
        </section>

        <section className="flex items-center justify-between gap-3">
          <Link href="/dashboard/integrations">
            <Button className="bg-blue-600 text-white hover:bg-blue-500">Back to Integrations</Button>
          </Link>
          <Link href="/dashboard/settings?tab=integrations">
            <Button variant="outline" className="border-zinc-700 bg-zinc-950 text-zinc-200 hover:text-white">
              Open API Vault
            </Button>
          </Link>
        </section>
      </div>
    </main>
  );
}

