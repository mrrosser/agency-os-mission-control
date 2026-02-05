"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/auth-provider";
import { Loader2 } from "lucide-react";
import { GridPattern } from "@/components/magicui/grid-pattern";

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      if (user) {
        router.push("/dashboard");
      } else {
        router.push("/login");
      }
    }
  }, [user, loading, router]);

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#05060b]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(700px_circle_at_12%_-10%,rgba(56,189,248,0.18),transparent_55%),radial-gradient(900px_circle_at_88%_10%,rgba(99,102,241,0.16),transparent_60%),radial-gradient(800px_circle_at_50%_90%,rgba(16,185,129,0.12),transparent_60%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(5,6,11,0.25),rgba(5,6,11,0.9))]" />
      <GridPattern className="text-white/8 [mask-image:radial-gradient(circle_at_center,white,transparent_70%)]" />
      <div className="relative z-10 flex min-h-screen w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    </div>
  );
}
