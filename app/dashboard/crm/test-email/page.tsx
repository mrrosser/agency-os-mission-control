import Link from "next/link";
import { WarmReconnectOwnerTest } from "@/components/crm/warm-reconnect-owner-test";

export default function CrmTestEmailPage() {
  return <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
    <Link href="/dashboard/crm" className="mb-4 inline-flex min-h-11 items-center text-sm text-zinc-300 underline underline-offset-4">Back to CRM</Link>
    <h1 className="mb-4 text-xl font-semibold text-white">Test your outreach email</h1>
    <WarmReconnectOwnerTest />
    <p className="text-sm text-zinc-400">Use the approved test inbox directly. You do not need to add or select a CRM contact.</p>
  </main>;
}
