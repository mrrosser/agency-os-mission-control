"use client";

import { useState, useEffect } from "react";
import {
    signInWithPopup,
    OAuthProvider,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signInWithPhoneNumber,
    RecaptchaVerifier
} from "@/lib/firebase";
import { auth, googleProvider, db } from "@/lib/firebase";
import { dbService } from "@/lib/db-service";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Rocket, AlertCircle, Mail, Phone, Apple, Github } from "lucide-react";

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
    const [confirmationResult, setConfirmationResult] = useState<any>(null);

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
        } catch (error: any) {
            console.error("Login failed:", error);
            setError(error.message || "Failed to sign in. Please try again.");
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
        } catch (error: any) {
            setError(error.message);
        } finally {
            setLoading(false);
        }
    };

    const setupRecaptcha = () => {
        if (!(window as any).recaptchaVerifier) {
            (window as any).recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
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
            const appVerifier = (window as any).recaptchaVerifier;
            const confirmation = await signInWithPhoneNumber(auth, phoneNumber, appVerifier);
            setConfirmationResult(confirmation);
            setShowOtp(true);
        } catch (error: any) {
            setError(error.message);
        } finally {
            setLoading(false);
        }
    };

    const verifyOtp = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            const result = await confirmationResult.confirm(otp);
            await dbService.syncUser(result.user);
            router.push("/dashboard");
        } catch (error: any) {
            setError(error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex h-screen w-full items-center justify-center bg-black overflow-hidden relative">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-900/10 via-black to-black" />

            <Card className="relative w-full max-w-sm border-zinc-800 bg-zinc-950/50 backdrop-blur-xl shadow-2xl z-10">
                <CardHeader className="text-center space-y-2">
                    <div className="flex justify-center mb-2">
                        <div className="p-3 rounded-2xl bg-blue-500/10 border border-blue-500/20">
                            <Rocket className="w-8 h-8 text-blue-500" />
                        </div>
                    </div>
                    <CardTitle className="text-2xl font-bold text-white">Mission Control</CardTitle>
                    <CardDescription className="text-zinc-400">
                        Access the Alpha OS infrastructure
                    </CardDescription>
                </CardHeader>

                <CardContent>
                    <div id="recaptcha-container"></div>

                    {error && (
                        <div className="mb-4 flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-500">
                            <AlertCircle className="h-4 w-4 shrink-0" />
                            <p>{error}</p>
                        </div>
                    )}

                    <Tabs defaultValue="social" className="w-full">
                        <TabsList className="grid w-full grid-cols-3 bg-zinc-900 mb-6">
                            <TabsTrigger value="social" className="data-[state=active]:bg-zinc-800">Social</TabsTrigger>
                            <TabsTrigger value="email" className="data-[state=active]:bg-zinc-800">Direct</TabsTrigger>
                            <TabsTrigger value="phone" className="data-[state=active]:bg-zinc-800">Phone</TabsTrigger>
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
                                className="w-full h-11 bg-zinc-800 text-white hover:bg-zinc-700 font-medium transition-all"
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
                                    <Label htmlFor="email">Email</Label>
                                    <Input
                                        id="email"
                                        type="email"
                                        placeholder="commander@agency.os"
                                        className="bg-zinc-900 border-zinc-800"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        required
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label htmlFor="password">Password</Label>
                                    <Input
                                        id="password"
                                        type="password"
                                        className="bg-zinc-900 border-zinc-800"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        required
                                    />
                                </div>
                                <Button className="w-full bg-blue-600 hover:bg-blue-500" disabled={loading}>
                                    {loading ? <Loader2 className="animate-spin h-4 w-4" /> : (isSignUp ? "Create Account" : "Sign In")}
                                </Button>
                                <button
                                    type="button"
                                    onClick={() => setIsSignUp(!isSignUp)}
                                    className="w-full text-xs text-zinc-500 hover:text-white transition-colors"
                                >
                                    {isSignUp ? "Already have an account? Sign in" : "Need an account? Sign up"}
                                </button>
                            </form>
                        </TabsContent>

                        <TabsContent value="phone" className="space-y-4">
                            {!showOtp ? (
                                <form onSubmit={handlePhoneSignIn} className="space-y-3">
                                    <div className="space-y-1">
                                        <Label htmlFor="phone">Phone Number</Label>
                                        <Input
                                            id="phone"
                                            type="tel"
                                            placeholder="+1 234 567 8900"
                                            className="bg-zinc-900 border-zinc-800"
                                            value={phoneNumber}
                                            onChange={(e) => setPhoneNumber(e.target.value)}
                                            required
                                        />
                                    </div>
                                    <Button className="w-full bg-zinc-800 hover:bg-zinc-700" disabled={loading}>
                                        {loading ? <Loader2 className="animate-spin h-4 w-4" /> : "Send Verification Code"}
                                    </Button>
                                </form>
                            ) : (
                                <form onSubmit={verifyOtp} className="space-y-3">
                                    <div className="space-y-1">
                                        <Label htmlFor="otp">Verification Code</Label>
                                        <Input
                                            id="otp"
                                            type="text"
                                            placeholder="123456"
                                            className="bg-zinc-900 border-zinc-800"
                                            value={otp}
                                            onChange={(e) => setOtp(e.target.value)}
                                            required
                                        />
                                    </div>
                                    <Button className="w-full bg-green-600 hover:bg-green-500" disabled={loading}>
                                        {loading ? <Loader2 className="animate-spin h-4 w-4" /> : "Verify Code"}
                                    </Button>
                                    <button
                                        type="button"
                                        onClick={() => setShowOtp(false)}
                                        className="w-full text-xs text-zinc-500 hover:text-white transition-colors"
                                    >
                                        Use a different number
                                    </button>
                                </form>
                            )}
                        </TabsContent>
                    </Tabs>

                    <p className="mt-6 text-[10px] text-center text-zinc-600 uppercase tracking-widest">
                        Agency OS Mission Control Alpha v0.1
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}
