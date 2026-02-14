"use client";

import { useState } from "react";
import Link from "next/link";
import type { ConfirmationResult } from "firebase/auth";
import {
    signInWithPopup,
    OAuthProvider,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signInWithPhoneNumber,
    RecaptchaVerifier
} from "@/lib/firebase";
import { auth, googleProvider } from "@/lib/firebase";
import { dbService } from "@/lib/db-service";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LeadFlowBackdrop } from "@/components/visuals/LeadFlowBackdrop";
import { AfroGlyph } from "@/components/branding/AfroGlyph";
import { Loader2, AlertCircle, Apple } from "lucide-react";

function isErrorWithMessage(error: unknown): error is { message: string } {
    return (
        typeof error === "object" &&
        error !== null &&
        "message" in error &&
        typeof (error as Record<string, unknown>).message === "string"
    );
}

declare global {
    interface Window {
        recaptchaVerifier?: RecaptchaVerifier;
    }
}

export default function LoginPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Email/Password state
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [isSignUp, setIsSignUp] = useState(false);

    // Phone state
    const [phoneNumber, setPhoneNumber] = useState("");
    const [otp, setOtp] = useState("");
    const [showOtp, setShowOtp] = useState(false);
    const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);

    const handleSocialLogin = async (providerName: 'google' | 'apple') => {
        setLoading(true);
        setError(null);
        try {
            let provider;
            if (providerName === 'google') {
                provider = googleProvider;
            } else {
                provider = new OAuthProvider('apple.com');
            }

            const result = await signInWithPopup(auth, provider);
            await dbService.syncUser(result.user);
            router.push("/dashboard");
        } catch (error: unknown) {
            console.error("Login failed:", error);
            setError(isErrorWithMessage(error) ? error.message : "Failed to sign in. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    const handleEmailAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            let user;
            if (isSignUp) {
                const result = await createUserWithEmailAndPassword(auth, email, password);
                user = result.user;
            } else {
                const result = await signInWithEmailAndPassword(auth, email, password);
                user = result.user;
            }
            await dbService.syncUser(user);
            router.push("/dashboard");
        } catch (error: unknown) {
            setError(isErrorWithMessage(error) ? error.message : "Failed to sign in. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    const setupRecaptcha = () => {
        if (!window.recaptchaVerifier) {
            window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
                'size': 'invisible'
            });
        }
    };

    const handlePhoneSignIn = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            setupRecaptcha();
            const appVerifier = window.recaptchaVerifier;
            if (!appVerifier) {
                throw new Error("Recaptcha verifier was not initialized.");
            }
            const confirmation = await signInWithPhoneNumber(auth, phoneNumber, appVerifier);
            setConfirmationResult(confirmation);
            setShowOtp(true);
        } catch (error: unknown) {
            setError(isErrorWithMessage(error) ? error.message : "Failed to start phone sign-in. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    const verifyOtp = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            if (!confirmationResult) {
                throw new Error("No confirmation result available. Please request a new verification code.");
            }
            const result = await confirmationResult.confirm(otp);
            await dbService.syncUser(result.user);
            router.push("/dashboard");
        } catch (error: unknown) {
            setError(isErrorWithMessage(error) ? error.message : "Failed to verify code. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="relative min-h-screen w-full overflow-hidden bg-[#05060b]">
            <LeadFlowBackdrop className="opacity-[0.96]" />
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(3,6,12,0.2),rgba(4,7,14,0.48)_35%,rgba(2,3,7,0.76)_80%)]" />
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(450px_circle_at_50%_50%,rgba(2,8,18,0.08),rgba(2,7,16,0.35),rgba(1,3,8,0.7))]" />
            <div className="pointer-events-none absolute left-1/2 top-1/2 h-[560px] w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/36 blur-3xl" />

            <div className="relative z-10 flex min-h-screen w-full items-center justify-center px-4 py-16">
                <div data-testid="login-card" className="w-full max-w-sm rounded-[24px] border border-white/18 bg-black/72 p-1.5 backdrop-blur-2xl shadow-[0_32px_90px_rgba(3,6,15,0.9)]">
                    <Card className="border-white/15 bg-black/86 shadow-none">
                        <CardHeader className="text-center space-y-2">
                            <div className="flex justify-center mb-2">
                                <div className="p-3 rounded-2xl bg-gradient-to-br from-sky-500/20 via-indigo-500/10 to-emerald-500/10 border border-white/10 shadow-[0_0_40px_rgba(56,189,248,0.25)]">
                                    <AfroGlyph variant="mission" className="h-8 w-8 text-sky-200" />
                                </div>
                            </div>
                            <CardTitle className="text-2xl font-semibold text-white">
                                Mission Control
                            </CardTitle>
                            <CardDescription className="text-slate-300/70">
                                Access the lead generation command center
                            </CardDescription>
                        </CardHeader>

                        <CardContent>
                            <div id="recaptcha-container"></div>

                            {error && (
                                <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
                                    <AlertCircle className="h-4 w-4 shrink-0" />
                                    <p>{error}</p>
                                </div>
                            )}

                            <Tabs defaultValue="social" className="w-full">
                                <TabsList className="grid w-full grid-cols-3 rounded-full border border-white/10 bg-white/5 p-1 mb-6">
                                    <TabsTrigger
                                        value="social"
                                        className="rounded-full text-xs tracking-wide text-white/70 data-[state=active]:bg-white/10 data-[state=active]:text-white data-[state=active]:shadow-none"
                                    >
                                        Social
                                    </TabsTrigger>
                                    <TabsTrigger
                                        value="email"
                                        className="rounded-full text-xs tracking-wide text-white/70 data-[state=active]:bg-white/10 data-[state=active]:text-white data-[state=active]:shadow-none"
                                    >
                                        Direct
                                    </TabsTrigger>
                                    <TabsTrigger
                                        value="phone"
                                        className="rounded-full text-xs tracking-wide text-white/70 data-[state=active]:bg-white/10 data-[state=active]:text-white data-[state=active]:shadow-none"
                                    >
                                        Phone
                                    </TabsTrigger>
                                </TabsList>

                                <TabsContent value="social" className="space-y-3">
                                    <Button
                                        className="w-full h-11 bg-white text-black hover:bg-zinc-200 font-medium transition-all flex items-center justify-center"
                                        onClick={() => handleSocialLogin('google')}
                                        disabled={loading}
                                    >
                                        <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                                            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                                            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                                            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                                            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                                        </svg>
                                        Continue with Google
                                    </Button>
                                    <Button
                                        className="w-full h-11 bg-white/10 text-white hover:bg-white/20 font-medium transition-all border border-white/10"
                                        onClick={() => handleSocialLogin('apple')}
                                        disabled={loading}
                                    >
                                        <Apple className="mr-2 h-4 w-4" />
                                        Continue with Apple
                                    </Button>
                                </TabsContent>

                                <TabsContent value="email" className="space-y-4">
                                    <form onSubmit={handleEmailAuth} className="space-y-3">
                                        <div className="space-y-1">
                                            <Label htmlFor="email" className="text-xs uppercase tracking-[0.2em] text-white/60">
                                                Email
                                            </Label>
                                            <Input
                                                id="email"
                                                type="email"
                                                placeholder="commander@agency.os"
                                                className="bg-black/30 border-white/10 text-white placeholder:text-white/40"
                                                value={email}
                                                onChange={(e) => setEmail(e.target.value)}
                                                required
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <Label htmlFor="password" className="text-xs uppercase tracking-[0.2em] text-white/60">
                                                Password
                                            </Label>
                                            <Input
                                                id="password"
                                                type="password"
                                                className="bg-black/30 border-white/10 text-white placeholder:text-white/40"
                                                value={password}
                                                onChange={(e) => setPassword(e.target.value)}
                                                required
                                            />
                                        </div>
                                        <Button className="w-full bg-gradient-to-r from-sky-400 via-indigo-400 to-cyan-300 text-slate-900 hover:opacity-90" disabled={loading}>
                                            {loading ? <Loader2 className="animate-spin h-4 w-4" /> : (isSignUp ? "Create Account" : "Sign In")}
                                        </Button>
                                        <button
                                            type="button"
                                            onClick={() => setIsSignUp(!isSignUp)}
                                            className="w-full text-xs text-white/50 hover:text-white transition-colors"
                                        >
                                            {isSignUp ? "Already have an account? Sign in" : "Need an account? Sign up"}
                                        </button>
                                    </form>
                                </TabsContent>

                                <TabsContent value="phone" className="space-y-4">
                                    {!showOtp ? (
                                        <form onSubmit={handlePhoneSignIn} className="space-y-3">
                                            <div className="space-y-1">
                                                <Label htmlFor="phone" className="text-xs uppercase tracking-[0.2em] text-white/60">
                                                    Phone Number
                                                </Label>
                                                <Input
                                                    id="phone"
                                                    type="tel"
                                                    placeholder="+1 234 567 8900"
                                                    className="bg-black/30 border-white/10 text-white placeholder:text-white/40"
                                                    value={phoneNumber}
                                                    onChange={(e) => setPhoneNumber(e.target.value)}
                                                    required
                                                />
                                            </div>
                                            <Button className="w-full bg-white/10 hover:bg-white/20 border border-white/10 text-white" disabled={loading}>
                                                {loading ? <Loader2 className="animate-spin h-4 w-4" /> : "Send Verification Code"}
                                            </Button>
                                        </form>
                                    ) : (
                                        <form onSubmit={verifyOtp} className="space-y-3">
                                            <div className="space-y-1">
                                                <Label htmlFor="otp" className="text-xs uppercase tracking-[0.2em] text-white/60">
                                                    Verification Code
                                                </Label>
                                                <Input
                                                    id="otp"
                                                    type="text"
                                                    placeholder="123456"
                                                    className="bg-black/30 border-white/10 text-white placeholder:text-white/40"
                                                    value={otp}
                                                    onChange={(e) => setOtp(e.target.value)}
                                                    required
                                                />
                                            </div>
                                            <Button className="w-full bg-emerald-400/90 text-emerald-950 hover:bg-emerald-400" disabled={loading}>
                                                {loading ? <Loader2 className="animate-spin h-4 w-4" /> : "Verify Code"}
                                            </Button>
                                            <button
                                                type="button"
                                                onClick={() => setShowOtp(false)}
                                                className="w-full text-xs text-white/50 hover:text-white transition-colors"
                                            >
                                                Use a different number
                                            </button>
                                        </form>
                                    )}
                                </TabsContent>
                            </Tabs>

                            <div className="mt-6 space-y-2">
                                <p className="text-[10px] text-center text-white/40 uppercase tracking-[0.4em]">
                                    Leadflow Mission Control Alpha v0.1
                                </p>
                                <div className="flex items-center justify-center gap-3 text-[11px] text-white/55">
                                    <Link className="hover:text-white" href="/privacy">
                                        Privacy Policy
                                    </Link>
                                    <span className="text-white/25">|</span>
                                    <Link className="hover:text-white" href="/terms">
                                        Terms of Service
                                    </Link>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
