"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { buildAuthHeaders, getResponseCorrelationId, readApiJson } from "@/lib/api/client";
import { CalendarEvent } from "@/lib/google/calendar";
import { Calendar, Plus, RefreshCw, AlertCircle, Clock, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { format } from "date-fns";

export default function CalendarPage() {
    const { user } = useAuth();
    const router = useRouter();
    const [events, setEvents] = useState<CalendarEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [notConnected, setNotConnected] = useState(false);

    const loadEvents = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        setNotConnected(false);
        try {
            const headers = await buildAuthHeaders(user);
            const res = await fetch("/api/calendar/events?action=list", {
                method: "POST",
                headers,
                body: JSON.stringify({ maxResults: 20 }),
            });

            if (res.status === 403 || res.status === 401) {
                setNotConnected(true);
                setLoading(false);
                return;
            }

            const data = await readApiJson<{ events?: CalendarEvent[]; error?: string }>(res);
            if (!res.ok) {
                const cid = getResponseCorrelationId(res);
                const baseMessage = data?.error || `Failed to load events (status ${res.status})`;
                throw new Error(`${baseMessage}${cid ? ` cid=${cid}` : ""}`);
            }
            setEvents(data.events || []);
        } catch (error: unknown) {
            console.error(error);
            toast.error("Could not load calendar", {
                description: error instanceof Error ? error.message : String(error),
            });
        } finally {
            setLoading(false);
        }
    }, [user]);

    useEffect(() => {
        loadEvents();
    }, [loadEvents]);

    // Show "Connect Google" prompt if not connected
    if (notConnected) {
        return (
            <div className="flex items-center justify-center h-screen bg-black p-6">
                <div className="max-w-md p-8 border border-zinc-800 rounded-lg bg-zinc-950 text-center">
                    <AlertCircle className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
                    <h2 className="text-xl font-bold text-white mb-2">Google Workspace Not Connected</h2>
                    <p className="text-zinc-400 mb-6">
                        To view your calendar, you need to connect your Google Workspace account first.
                    </p>
                    <Button
                        onClick={() => router.push("/dashboard/integrations")}
                        className="bg-blue-600 hover:bg-blue-500 text-white"
                    >
                        Go to Integrations
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-black p-6 md:p-8">
            <div className="max-w-5xl mx-auto space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Calendar className="h-8 w-8 text-blue-500" />
                        <h1 className="text-3xl font-bold text-white">Calendar</h1>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={loadEvents}
                            disabled={loading}
                            className="text-zinc-400 hover:text-white"
                        >
                            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                        </Button>
                        <Button
                            onClick={() => toast.info("Create event coming soon")}
                            className="bg-blue-600 hover:bg-blue-500 text-white"
                        >
                            <Plus className="h-4 w-4 mr-2" />
                            Create Event
                        </Button>
                    </div>
                </div>

                {/* Events List */}
                {loading ? (
                    <div className="space-y-3">
                        {[...Array(5)].map((_, i) => (
                            <div key={i} className="h-32 rounded-lg bg-zinc-900/50 animate-pulse" />
                        ))}
                    </div>
                ) : events.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center text-zinc-500">
                        <Calendar className="h-16 w-16 mb-4 opacity-20" />
                        <p className="text-lg">No upcoming events</p>
                        <p className="text-sm">Create your first event to get started</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {events.map((event) => {
                            const startTime = event.start.dateTime
                                ? new Date(event.start.dateTime)
                                : event.start.date
                                    ? new Date(event.start.date)
                                    : null;

                            return (
                                <div
                                    key={event.id}
                                    className="p-4 border border-zinc-800 rounded-lg bg-zinc-950 hover:bg-zinc-900 transition-colors"
                                >
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <h3 className="text-lg font-semibold text-white mb-1">
                                                {event.summary}
                                            </h3>
                                            {event.description && (
                                                <p className="text-sm text-zinc-400 mb-2 line-clamp-2">
                                                    {event.description}
                                                </p>
                                            )}
                                            <div className="flex flex-wrap items-center gap-4 text-sm text-zinc-500">
                                                {startTime && (
                                                    <div className="flex items-center gap-2">
                                                        <Clock className="h-4 w-4" />
                                                        {format(startTime, "PPP p")}
                                                    </div>
                                                )}
                                                {event.location && (
                                                    <div className="flex items-center gap-2">
                                                        <MapPin className="h-4 w-4" />
                                                        {event.location}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
