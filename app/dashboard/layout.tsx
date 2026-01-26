"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Rocket, Shield, Key, PenTool, LayoutDashboard, Zap } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { AuthGuard } from "@/components/guards/auth-guard";
import { Button } from "@/components/ui/button";
import { auth } from "@/lib/firebase";
import { toast } from "sonner";

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
            <div className="flex min-h-screen bg-black text-white">
                {/* Sidebar */}
                <div className="w-64 border-r border-zinc-800 bg-zinc-950 p-4 flex flex-col">
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

                    <div className="mt-auto border-t border-zinc-800 pt-4 px-2">
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
                            className="w-full justify-start text-zinc-400 hover:text-white border-zinc-800 hover:bg-zinc-900"
                            onClick={handleLogout}
                        >
                            Sign Out
                        </Button>
                    </div>
                </div>

                {/* Main Content */}
                <div className="flex-1 overflow-auto bg-black">
                    {children}
                </div>
            </div>
        </AuthGuard>
    );
}
