"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/auth-provider";
import { doc, setDoc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

const identitySchema = z.object({
    businessName: z.string().min(2),
    founderName: z.string().min(2),
    coreValue: z.string().min(10, "Give a bit more detail on the core value"),
    primaryService: z.string().min(2),
    keyBenefit: z.string().min(5),
    avatarTone: z.string().min(2),
});

export default function IdentityPage() {
    const { user } = useAuth();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const form = useForm<z.infer<typeof identitySchema>>({
        resolver: zodResolver(identitySchema),
        defaultValues: {
            businessName: "",
            founderName: "",
            coreValue: "",
            primaryService: "",
            keyBenefit: "",
            avatarTone: "Professional and energetic"
        }
    });

    // Load identity data from Firestore
    useEffect(() => {
        const loadIdentity = async () => {
            if (!user) return;

            try {
                const docRef = doc(db, "identities", user.uid);
                const docSnap = await getDoc(docRef);

                if (docSnap.exists()) {
                    form.reset(docSnap.data() as z.infer<typeof identitySchema>);
                }
            } catch (error) {
                console.error("Failed to load identity:", error);
                toast.error("Failed to load saved identity");
            } finally {
                setLoading(false);
            }
        };

        loadIdentity();
    }, [user, form]);

    const onSubmit = async (data: z.infer<typeof identitySchema>) => {
        if (!user) {
            toast.error("You must be logged in to save");
            return;
        }

        setSaving(true);

        try {
            // Save to Firestore
            const docRef = doc(db, "identities", user.uid);
            await setDoc(docRef, {
                ...data,
                updatedAt: new Date().toISOString(),
                userId: user.uid,
                userEmail: user.email
            });

            toast.success("Identity Saved", {
                description: "Your Sales Robot has been updated with new context.",
            });
        } catch (error) {
            console.error("Save error:", error);
            toast.error("Failed to save identity");
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            </div>
        );
    }

    return (
        <div className="space-y-6 p-6 md:p-8">
            <div>
                <h2 className="text-2xl font-bold tracking-tight text-white">Identity & Offer</h2>
                <p className="text-zinc-400">
                    This is the "Brain" of your Sales Robot. It reads this to know what to sell.
                </p>
            </div>

            <Card className="border-zinc-800 bg-zinc-950">
                <CardHeader>
                    <CardTitle className="text-white">Business Context</CardTitle>
                    <CardDescription className="text-zinc-400">Define who you are and what you offer.</CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label className="text-zinc-200">Business Name</Label>
                                <Input
                                    {...form.register("businessName")}
                                    placeholder="Acme Agency"
                                    className="bg-zinc-900 border-zinc-700 text-white"
                                />
                                {form.formState.errors.businessName && <p className="text-xs text-red-500">{form.formState.errors.businessName.message}</p>}
                            </div>
                            <div className="space-y-2">
                                <Label className="text-zinc-200">Founder Name</Label>
                                <Input
                                    {...form.register("founderName")}
                                    placeholder="John Doe"
                                    className="bg-zinc-900 border-zinc-700 text-white"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label className="text-zinc-200">Core Value Pitch</Label>
                            <Textarea
                                {...form.register("coreValue")}
                                placeholder="We help X do Y by Z..."
                                className="bg-zinc-900 border-zinc-700 text-white min-h-[100px]"
                            />
                            {form.formState.errors.coreValue && <p className="text-xs text-red-500">{form.formState.errors.coreValue.message}</p>}
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label className="text-zinc-200">Primary Service</Label>
                                <Input
                                    {...form.register("primaryService")}
                                    placeholder="SEO Optimization"
                                    className="bg-zinc-900 border-zinc-700 text-white"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label className="text-zinc-200">Key Benefit</Label>
                                <Input
                                    {...form.register("keyBenefit")}
                                    placeholder="2x Traffic in 30 days"
                                    className="bg-zinc-900 border-zinc-700 text-white"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label className="text-zinc-200">Avatar Tone</Label>
                            <Input
                                {...form.register("avatarTone")}
                                placeholder="Professional, Witty, Casual"
                                className="bg-zinc-900 border-zinc-700 text-white"
                            />
                        </div>

                        <Button
                            type="submit"
                            disabled={saving}
                            className="bg-blue-600 hover:bg-blue-500 text-white h-11"
                        >
                            {saving ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Saving...
                                </>
                            ) : (
                                "Save Identity"
                            )}
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
