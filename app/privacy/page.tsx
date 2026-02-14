import Link from "next/link";

export const metadata = {
  title: "Privacy Policy | Mission Control",
  description: "Privacy policy for Mission Control by Agency OS.",
};

export default function PrivacyPage() {
  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-[#05060b] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(700px_circle_at_12%_-10%,rgba(56,189,248,0.18),transparent_55%),radial-gradient(900px_circle_at_88%_10%,rgba(99,102,241,0.16),transparent_60%),radial-gradient(800px_circle_at_50%_90%,rgba(16,185,129,0.12),transparent_60%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(5,6,11,0.2),rgba(5,6,11,0.92))]" />

      <div className="relative z-10 mx-auto w-full max-w-4xl px-6 py-12 md:px-10">
        <header className="mb-8 rounded-2xl border border-white/10 bg-black/40 p-6 backdrop-blur-xl">
          <p className="text-xs uppercase tracking-[0.25em] text-cyan-200/70">Mission Control</p>
          <h1 className="mt-2 text-3xl font-semibold">Privacy Policy</h1>
          <p className="mt-3 text-sm text-zinc-300">
            Effective date: February 12, 2026
          </p>
        </header>

        <section className="space-y-6 rounded-2xl border border-white/10 bg-black/40 p-6 text-sm leading-7 text-zinc-200 backdrop-blur-xl">
          <div>
            <h2 className="text-lg font-semibold text-white">Information We Collect</h2>
            <p>
              Mission Control stores account profile details, workspace settings, integration metadata, and operational
              telemetry needed to run lead generation and outreach workflows.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-white">How We Use Data</h2>
            <p>
              Data is used to authenticate users, execute requested workflows, display run history, troubleshoot errors,
              and improve reliability. We do not sell personal data.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-white">Google User Data</h2>
            <p>
              If you connect Google Workspace, access tokens and granted scopes are used only for requested features
              such as Gmail, Drive, and Calendar actions. Google data is not used for advertising.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-white">Security and Retention</h2>
            <p>
              Secrets are managed using cloud secret management, and access is restricted by project IAM policy. Data
              is retained for operational continuity and compliance, then removed according to workspace lifecycle rules.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-white">Policy Updates</h2>
            <p>
              This policy may be updated as the product evolves. Material changes are reflected by updating the
              effective date on this page.
            </p>
          </div>
        </section>

        <footer className="mt-6 flex flex-wrap items-center gap-4 text-sm text-zinc-300">
          <Link className="rounded-md border border-white/15 bg-white/5 px-3 py-1.5 hover:bg-white/10" href="/terms">
            Terms of Service
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
