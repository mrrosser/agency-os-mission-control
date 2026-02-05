"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Rocket, Shield, Key, PenTool, LayoutDashboard, Zap, Mail } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { AuthGuard } from "@/components/guards/auth-guard";
import { Button } from "@/components/ui/button";
import { auth } from "@/lib/firebase";
import { toast } from "sonner";
import { GridPattern } from "@/components/magicui/grid-pattern";

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const pathname = usePathname();
    const router = useRouter();
    const { user } = useAuth();

    const links = [
        { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
        { href: "/dashboard/identity", label: "Identity (The Offer)", icon: PenTool },
        { href: "/dashboard/operations", label: "Operations", icon: Rocket },
        { href: "/dashboard/inbox", label: "Inbox", icon: Mail },
        { href: "/dashboard/calendar", label: "Calendar", icon: LayoutDashboard },
        { href: "/dashboard/integrations", label: "Integrations", icon: Zap },
        { href: "/dashboard/settings", label: "API Vault", icon: Key },
    ];

    const handleLogout = async () => {
        try {
            await auth.signOut();
            toast.success("Signed out successfully");
            router.push("/login");
        } catch (error) {
            console.error("Logout error:", error);
            toast.error("Failed to sign out");
        }
    };

    return (
        <AuthGuard>
            <div className="relative min-h-screen w-full overflow-hidden bg-[#05060b] text-white">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(700px_circle_at_10%_-10%,rgba(56,189,248,0.16),transparent_55%),radial-gradient(900px_circle_at_90%_10%,rgba(99,102,241,0.14),transparent_60%),radial-gradient(800px_circle_at_50%_90%,rgba(16,185,129,0.1),transparent_60%)]" />
                <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(5,6,11,0.2),rgba(5,6,11,0.92))]" />
                <GridPattern className="text-white/6 [mask-image:radial-gradient(circle_at_center,white,transparent_70%)]" />

                <div className="relative z-10 flex min-h-screen w-full">
                    {/* Sidebar */}
                    <div className="w-64 border-r border-white/10 bg-black/70 backdrop-blur-xl p-4 flex flex-col">
                    <div className="flex items-center gap-2 px-2 py-4 mb-8">
                        <Shield className="h-6 w-6 text-blue-500" />
                        <span className="text-lg font-bold">Mission Control</span>
                    </div>

                    <nav className="flex-1 space-y-1">
                        {links.map((link) => {
                            const Icon = link.icon;
                            const isActive = pathname === link.href;
                            return (
                                <Link
                                    key={link.href}
                                    href={link.href}
                                    className={cn(
                                        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                                        isActive
                                            ? "bg-blue-500/10 text-blue-500"
                                            : "text-zinc-400 hover:bg-zinc-900 hover:text-white"
                                    )}
                                >
                                    <Icon className="h-4 w-4" />
                                    {link.label}
                                </Link>
                            );
                        })}
                    </nav>

                    <div className="mt-auto border-t border-white/10 pt-4 px-2">
                        <div className="flex items-center gap-3 mb-4">
                            {/* User Avatar */}
                            <div className="h-8 w-8 rounded-full bg-zinc-800 flex items-center justify-center text-xs">
                                {user?.email?.[0].toUpperCase() || 'U'}
                            </div>
                            <div className="text-xs">
                                <p className="font-medium text-white max-w-[140px] truncate">{user?.displayName || "Agent"}</p>
                                <p className="text-zinc-500 max-w-[140px] truncate">{user?.email || 'user@example.com'}</p>
                            </div>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            className="w-full justify-start text-zinc-300 hover:text-white border-white/10 hover:bg-white/10"
                            onClick={handleLogout}
                        >
                            Sign Out
                        </Button>
                    </div>
                </div>

                    {/* Main Content */}
                    <div className="flex-1 overflow-auto bg-black/50 backdrop-blur-xl">
                        {children}
                    </div>
                </div>
            </div>
        </AuthGuard>
    );
}
