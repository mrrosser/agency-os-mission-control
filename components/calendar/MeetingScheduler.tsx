"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Calendar, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { buildAuthHeaders, getResponseCorrelationId, readApiJson } from "@/lib/api/client";
import type { CalendarEvent, CreateEventInput } from "@/lib/google/calendar";

interface MeetingSchedulerProps {
    defaultAttendee?: string;
    onScheduled?: (event: CalendarEvent) => void;
}

export function MeetingScheduler({ defaultAttendee = "", onScheduled }: MeetingSchedulerProps) {
    const { user } = useAuth();
    const [title, setTitle] = useState("");
    const [attendeeEmail, setAttendeeEmail] = useState(defaultAttendee);
    const [startDate, setStartDate] = useState("");
    const [startTime, setStartTime] = useState("");
    const [duration, setDuration] = useState(30);
    const [description, setDescription] = useState("");
    const [checking, setChecking] = useState(false);
    const [creating, setCreating] = useState(false);
    const [isAvailable, setIsAvailable] = useState<boolean | null>(null);

    const handleCheckAvailability = async () => {
        if (!startDate || !startTime) {
            toast.error("Please select date and time");
            return;
        }

        if (!user) {
            toast.error("You must be logged in");
            return;
        }

        setChecking(true);
        setIsAvailable(null);

        try {
            const headers = await buildAuthHeaders(user);
            const startDateTime = new Date(`${startDate}T${startTime}`);
            const endDateTime = new Date(startDateTime.getTime() + duration * 60000);

            const response = await fetch("/api/calendar/availability", {
                method: "POST",
                headers,
                body: JSON.stringify({
                    startTime: startDateTime.toISOString(),
                    endTime: endDateTime.toISOString(),
                }),
            });

            const result = await readApiJson<{ available?: boolean; error?: string }>(response);

            if (response.ok) {
                const available = Boolean(result?.available);
                setIsAvailable(available);
                if (available) {
                    toast.success("Time slot is available!");
                } else {
                    toast.warning("Time conflict detected", {
                        description: "This time slot is already booked",
                    });
                }
            } else {
                const cid = getResponseCorrelationId(response);
                const baseMessage = result?.error || `Failed to check availability (status ${response.status})`;
                throw new Error(`${baseMessage}${cid ? ` cid=${cid}` : ""}`);
            }
        } catch (error: unknown) {
            console.error("Availability check error:", error);
            toast.error("Failed to check availability", {
                description: error instanceof Error ? error.message : String(error),
            });
        } finally {
            setChecking(false);
        }
    };

    const handleCreateMeeting = async () => {
        if (!title || !startDate || !startTime) {
            toast.error("Please fill in all required fields");
            return;
        }

        if (!user) {
            toast.error("You must be logged in");
            return;
        }

        setCreating(true);

        try {
            const headers = await buildAuthHeaders(user, {
                idempotencyKey: crypto.randomUUID(),
            });
            const startDateTime = new Date(`${startDate}T${startTime}`);
            const endDateTime = new Date(startDateTime.getTime() + duration * 60000);

            const event: CreateEventInput = {
                summary: title,
                description: description || undefined,
                start: {
                    dateTime: startDateTime.toISOString(),
                    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                },
                end: {
                    dateTime: endDateTime.toISOString(),
                    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                },
                attendees: attendeeEmail
                    ? [{ email: attendeeEmail }]
                    : undefined,
                conferenceData: {
                    createRequest: {
                        requestId: crypto.randomUUID(),
                        conferenceSolutionKey: { type: "hangoutsMeet" },
                    },
                },
            };

            const response = await fetch("/api/calendar/create-event", {
                method: "POST",
                headers,
                body: JSON.stringify({
                    event,
                }),
            });

            const result = await readApiJson<{ event?: CalendarEvent; error?: string }>(response);

            if (response.ok) {
                toast.success("Meeting scheduled!", {
                    description: "Calendar invite sent to attendees",
                });

                if (onScheduled) {
                    if (result.event) onScheduled(result.event);
                }

                // Reset form
                setTitle("");
                setAttendeeEmail("");
                setStartDate("");
                setStartTime("");
                setDescription("");
                setIsAvailable(null);
            } else {
                const cid = getResponseCorrelationId(response);
                const baseMessage = result?.error || `Failed to create meeting (status ${response.status})`;
                throw new Error(`${baseMessage}${cid ? ` cid=${cid}` : ""}`);
            }
        } catch (error: unknown) {
            console.error("Create meeting error:", error);
            toast.error("Failed to schedule meeting", {
                description: error instanceof Error ? error.message : String(error),
            });
        } finally {
            setCreating(false);
        }
    };

    // Get today's date in YYYY-MM-DD format for min attribute
    const today = new Date().toISOString().split("T")[0];

    return (
        <Card className="bg-zinc-950 border-zinc-800 shadow-lg">
            <CardHeader className="border-b border-zinc-800">
                <CardTitle className="text-white flex items-center gap-2">
                    <Calendar className="h-5 w-5 text-blue-500" />
                    Schedule Meeting
                </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
                <div className="space-y-2">
                    <Label className="text-zinc-200">Meeting Title *</Label>
                    <Input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="Discovery Call with Prospect"
                        className="bg-zinc-900 border-zinc-700 text-white"
                    />
                </div>

                <div className="space-y-2">
                    <Label className="text-zinc-200">Attendee Email</Label>
                    <Input
                        value={attendeeEmail}
                        onChange={(e) => setAttendeeEmail(e.target.value)}
                        placeholder="attendee@example.com"
                        type="email"
                        className="bg-zinc-900 border-zinc-700 text-white"
                    />
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label className="text-zinc-200">Date *</Label>
                        <Input
                            value={startDate}
                            onChange={(e) => {
                                setStartDate(e.target.value);
                                setIsAvailable(null);
                            }}
                            type="date"
                            min={today}
                            className="bg-zinc-900 border-zinc-700 text-white"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label className="text-zinc-200">Time *</Label>
                        <Input
                            value={startTime}
                            onChange={(e) => {
                                setStartTime(e.target.value);
                                setIsAvailable(null);
                            }}
                            type="time"
                            className="bg-zinc-900 border-zinc-700 text-white"
                        />
                    </div>
                </div>

                <div className="space-y-2">
                    <Label className="text-zinc-200">Duration (minutes)</Label>
                    <div className="flex gap-2">
                        {[15, 30, 45, 60].map((min) => (
                            <Button
                                key={min}
                                variant={duration === min ? "default" : "outline"}
                                size="sm"
                                onClick={() => setDuration(min)}
                                className={
                                    duration === min
                                        ? "bg-blue-600 hover:bg-blue-500"
                                        : "border-zinc-700 text-zinc-400 hover:text-white"
                                }
                            >
                                {min}m
                            </Button>
                        ))}
                    </div>
                </div>

                <div className="space-y-2">
                    <Label className="text-zinc-200">Description (Optional)</Label>
                    <Input
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Agenda or notes"
                        className="bg-zinc-900 border-zinc-700 text-white"
                    />
                </div>

                {/* Availability Status */}
                {isAvailable !== null && (
                    <div
                        className={`flex items-center gap-2 p-3 rounded-lg ${isAvailable
                                ? "bg-green-500/10 border border-green-500/20"
                                : "bg-red-500/10 border border-red-500/20"
                            }`}
                    >
                        {isAvailable ? (
                            <>
                                <CheckCircle2 className="h-4 w-4 text-green-500" />
                                <span className="text-sm text-green-500">Time slot available</span>
                            </>
                        ) : (
                            <>
                                <AlertCircle className="h-4 w-4 text-red-500" />
                                <span className="text-sm text-red-500">Time conflict detected</span>
                            </>
                        )}
                    </div>
                )}

                <div className="flex items-center gap-3 pt-4 border-t border-zinc-800">
                    <Button
                        onClick={handleCheckAvailability}
                        disabled={checking || !startDate || !startTime}
                        variant="outline"
                        className="border-zinc-700 text-zinc-400 hover:text-white"
                    >
                        {checking ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Checking...
                            </>
                        ) : (
                            "Check Availability"
                        )}
                    </Button>

                    <Button
                        onClick={handleCreateMeeting}
                        disabled={creating || !title || !startDate || !startTime || isAvailable === false}
                        className="flex-1 bg-blue-600 hover:bg-blue-500 text-white"
                    >
                        {creating ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Creating...
                            </>
                        ) : (
                            <>
                                <Calendar className="mr-2 h-4 w-4" />
                                Schedule Meeting
                            </>
                        )}
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
