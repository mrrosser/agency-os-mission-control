"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { AfroGlyph, type AfroGlyphVariant } from "@/components/branding/AfroGlyph";
import { useAuth } from "@/components/providers/auth-provider";
import { AuthGuard } from "@/components/guards/auth-guard";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { auth } from "@/lib/firebase";
import { toast } from "sonner";
import { GridPattern } from "@/components/magicui/grid-pattern";
import { FirstScanTour } from "@/components/onboarding/FirstScanTour";
import { Menu } from "lucide-react";

const DASHBOARD_LINKS = [
    { href: "/dashboard", label: "Overview", icon: "overview" as AfroGlyphVariant },
    { href: "/dashboard/identity", label: "Identity (The Offer)", icon: "identity" as AfroGlyphVariant },
    { href: "/dashboard/operations", label: "Operations", icon: "operations" as AfroGlyphVariant },
    { href: "/dashboard/crm", label: "CRM", icon: "people" as AfroGlyphVariant },
    { href: "/dashboard/competitors", label: "Competitors", icon: "trend" as AfroGlyphVariant },
    { href: "/dashboard/agents", label: "Agent Nexus", icon: "network" as AfroGlyphVariant },
    { href: "/dashboard/inbox", label: "Inbox", icon: "inbox" as AfroGlyphVariant },
    { href: "/dashboard/calendar", label: "Calendar", icon: "calendar" as AfroGlyphVariant },
    { href: "/dashboard/integrations", label: "Integrations", icon: "integrations" as AfroGlyphVariant },
    { href: "/dashboard/settings", label: "API Vault", icon: "vault" as AfroGlyphVariant },
];

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const pathname = usePathname();
    const router = useRouter();
    const { user } = useAuth();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);

    const activeLink = DASHBOARD_LINKS.find((link) =>
        link.href === "/dashboard"
            ? pathname === link.href
            : pathname === link.href || pathname.startsWith(`${link.href}/`)
    );

    const handleLogout = async () => {
        setMobileNavOpen(false);
        try {
            await auth.signOut();
            toast.success("Signed out successfully");
            router.push("/login");
        } catch (error) {
            console.error("Logout error:", error);
            toast.error("Failed to sign out");
        }
    };

    const navigationPanel = (label: string) => (
        <>
            <div className="mb-6 flex items-center gap-2 px-2 py-4">
                <AfroGlyph variant="mission" className="h-6 w-6 text-cyan-300" aria-hidden="true" />
                <span className="text-lg font-bold">Mission Control</span>
            </div>

            <nav aria-label={label} className="flex-1 space-y-1 overflow-y-auto">
                {DASHBOARD_LINKS.map((link) => {
                    const isActive = link.href === "/dashboard"
                        ? pathname === link.href
                        : pathname === link.href || pathname.startsWith(`${link.href}/`);
                    return (
                        <Link
                            key={link.href}
                            href={link.href}
                            aria-current={isActive ? "page" : undefined}
                            onClick={() => setMobileNavOpen(false)}
                            className={cn(
                                "flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70",
                                isActive
                                    ? "bg-blue-500/10 text-blue-400"
                                    : "text-zinc-400 hover:bg-zinc-900 hover:text-white"
                            )}
                        >
                            <AfroGlyph variant={link.icon} className="h-4 w-4" aria-hidden="true" />
                            {link.label}
                        </Link>
                    );
                })}
            </nav>

            <div className="mt-auto border-t border-white/10 px-2 pt-4">
                <div className="mb-4 flex items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs">
                        {user?.email?.[0].toUpperCase() || "U"}
                    </div>
                    <div className="min-w-0 text-xs">
                        <p className="truncate font-medium text-white">{user?.displayName || "Agent"}</p>
                        <p className="truncate text-zinc-500">{user?.email || "user@example.com"}</p>
                    </div>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-start border-white/10 text-zinc-300 hover:bg-white/10 hover:text-white"
                    onClick={handleLogout}
                >
                    Sign Out
                </Button>
                <div className="mt-3 flex items-center justify-center gap-3 text-[11px] text-zinc-500">
                    <Link className="hover:text-zinc-300" href="/privacy">
                        Privacy
                    </Link>
                    <span className="text-zinc-700">|</span>
                    <Link className="hover:text-zinc-300" href="/terms">
                        Terms
                    </Link>
                </div>
            </div>
        </>
    );

    return (
        <AuthGuard>
            <div className="relative min-h-dvh w-full overflow-hidden bg-[#05060b] text-white">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(700px_circle_at_10%_-10%,rgba(56,189,248,0.16),transparent_55%),radial-gradient(900px_circle_at_90%_10%,rgba(99,102,241,0.14),transparent_60%),radial-gradient(800px_circle_at_50%_90%,rgba(16,185,129,0.1),transparent_60%)]" />
                <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(5,6,11,0.2),rgba(5,6,11,0.92))]" />
                <GridPattern className="text-white/6 [mask-image:radial-gradient(circle_at_center,white,transparent_70%)]" />

                <div className="relative z-10 flex min-h-dvh w-full">
                    <aside className="hidden w-64 shrink-0 flex-col border-r border-white/10 bg-black/70 p-4 backdrop-blur-xl lg:flex">
                        {navigationPanel("Primary navigation")}
                    </aside>

                    <div className="min-w-0 flex-1 overflow-y-auto bg-black/50 backdrop-blur-xl">
                        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-white/10 bg-black/85 px-4 backdrop-blur-xl lg:hidden">
                            <Dialog open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
                                <DialogTrigger asChild>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="icon"
                                        aria-label="Open navigation menu"
                                        className="h-11 w-11 shrink-0 border-white/15 bg-white/5 text-white hover:bg-white/10"
                                    >
                                        <Menu className="h-5 w-5" aria-hidden="true" />
                                    </Button>
                                </DialogTrigger>
                                <DialogContent className="left-0 top-0 flex h-dvh max-h-dvh w-[min(20rem,88vw)] max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-y-0 border-l-0 border-r border-white/10 bg-black/95 p-4 text-white shadow-2xl">
                                    <DialogTitle className="sr-only">Mission Control navigation</DialogTitle>
                                    {navigationPanel("Mobile navigation")}
                                </DialogContent>
                            </Dialog>
                            <div className="min-w-0">
                                <p className="text-[10px] uppercase tracking-[0.24em] text-cyan-300/70">Mission Control</p>
                                <p className="truncate text-sm font-semibold text-white">{activeLink?.label || "Dashboard"}</p>
                            </div>
                        </header>
                        {children}
                    </div>
                </div>
            </div>
            <FirstScanTour />
        </AuthGuard>
    );
}
