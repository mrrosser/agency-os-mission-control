import Link from "next/link";
import { Button } from "@/components/ui/button";
import { GridPattern } from "@/components/magicui/grid-pattern";
import { AfroGlyph } from "@/components/branding/AfroGlyph";

export default function Home() {
  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-[#05060b] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(700px_circle_at_12%_-10%,rgba(56,189,248,0.18),transparent_55%),radial-gradient(900px_circle_at_88%_10%,rgba(99,102,241,0.16),transparent_60%),radial-gradient(800px_circle_at_50%_90%,rgba(16,185,129,0.12),transparent_60%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(5,6,11,0.25),rgba(5,6,11,0.9))]" />
      <GridPattern className="text-white/8 [mask-image:radial-gradient(circle_at_center,white,transparent_70%)]" />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-4xl flex-col items-center justify-center px-6 py-14 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 backdrop-blur">
          <AfroGlyph variant="mission" className="h-5 w-5 text-cyan-200" />
          <span className="text-xs uppercase tracking-[0.32em] text-white/70">Mission Control</span>
        </div>

        <h1 className="mt-6 text-4xl font-semibold tracking-tight md:text-5xl">
          Leadflow Mission Control
        </h1>
        <p className="mt-4 max-w-2xl text-sm text-zinc-300 md:text-base">
          Connect Google Workspace, source leads, and orchestrate outreach with a transparent run log and idempotent actions.
        </p>

        <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:justify-center">
          <Button asChild className="bg-white text-black hover:bg-zinc-200">
            <Link href="/login">Continue to Login</Link>
          </Button>
          <Button asChild variant="outline" className="border-white/15 bg-white/5 text-white hover:bg-white/10">
            <Link href="/dashboard">Open App</Link>
          </Button>
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3 text-xs text-white/60">
          <Link className="hover:text-white" href="/privacy">
            Privacy Policy
          </Link>
          <span className="text-white/20">|</span>
          <Link className="hover:text-white" href="/terms">
            Terms of Service
          </Link>
        </div>
      </div>
    </main>
  );
}
