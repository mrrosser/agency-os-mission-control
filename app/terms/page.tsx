import Link from "next/link";

export const metadata = {
  title: "Terms of Service | Mission Control",
  description: "Terms of service for Mission Control by Agency OS.",
};

export default function TermsPage() {
  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-[#05060b] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(700px_circle_at_12%_-10%,rgba(56,189,248,0.18),transparent_55%),radial-gradient(900px_circle_at_88%_10%,rgba(99,102,241,0.16),transparent_60%),radial-gradient(800px_circle_at_50%_90%,rgba(16,185,129,0.12),transparent_60%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(5,6,11,0.2),rgba(5,6,11,0.92))]" />

      <div className="relative z-10 mx-auto w-full max-w-4xl px-6 py-12 md:px-10">
        <header className="mb-8 rounded-2xl border border-white/10 bg-black/40 p-6 backdrop-blur-xl">
          <p className="text-xs uppercase tracking-[0.25em] text-cyan-200/70">Mission Control</p>
          <h1 className="mt-2 text-3xl font-semibold">Terms of Service</h1>
          <p className="mt-3 text-sm text-zinc-300">
            Effective date: February 12, 2026
          </p>
        </header>

        <section className="space-y-6 rounded-2xl border border-white/10 bg-black/40 p-6 text-sm leading-7 text-zinc-200 backdrop-blur-xl">
          <div>
            <h2 className="text-lg font-semibold text-white">Acceptance of Terms</h2>
            <p>
              By using Mission Control, you agree to these terms and to all applicable laws and platform policies.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-white">Authorized Use</h2>
            <p>
              You are responsible for your account activity and must use the service only for lawful business
              operations. You must not use the platform for spam, abuse, or unauthorized data access.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-white">Third-Party Integrations</h2>
            <p>
              Features may depend on Google Workspace and other providers. Availability and behavior of those services
              are controlled by their respective terms and APIs.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-white">User Responsibilities</h2>
            <p>
              You are responsible for review and approval of outreach content, calendar bookings, and lead processing
              workflows before production use.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-white">Service Changes and Termination</h2>
            <p>
              We may update, suspend, or discontinue features to improve reliability and security. Access may be
              suspended for terms violations or operational risk.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-white">Disclaimer</h2>
            <p>
              Mission Control is provided on an as-is basis. To the maximum extent permitted by law, we disclaim
              implied warranties and limit liability for indirect or consequential damages.
            </p>
          </div>
        </section>

        <footer className="mt-6 flex flex-wrap items-center gap-4 text-sm text-zinc-300">
          <Link className="rounded-md border border-white/15 bg-white/5 px-3 py-1.5 hover:bg-white/10" href="/privacy">
            Privacy Policy
          </Link>
          <Link className="rounded-md border border-white/15 bg-white/5 px-3 py-1.5 hover:bg-white/10" href="/login">
            Back to Login
          </Link>
          <Link className="rounded-md border border-white/15 bg-white/5 px-3 py-1.5 hover:bg-white/10" href="/dashboard">
            Open App
          </Link>
        </footer>
      </div>
    </main>
  );
}
