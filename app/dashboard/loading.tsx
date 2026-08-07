export default function DashboardLoading() {
  return (
    <main className="min-h-screen bg-[#05060b] p-4 text-white sm:p-6 md:p-8" aria-busy="true" aria-label="Loading Mission Control">
      <div className="mx-auto max-w-7xl space-y-5 animate-pulse">
        <div className="h-8 w-52 rounded-lg bg-white/10" />
        <div className="h-4 w-full max-w-xl rounded bg-white/5" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="h-28 rounded-xl border border-white/10 bg-white/5" />
          ))}
        </div>
        <div className="h-80 rounded-xl border border-white/10 bg-white/5" />
      </div>
      <span className="sr-only">Loading Mission Control…</span>
    </main>
  );
}
