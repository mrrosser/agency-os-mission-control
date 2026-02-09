"use client";

import { useState, useEffect } from "react";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Calendar } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { collection, query, where, onSnapshot, doc, updateDoc, addDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

// --- Types ---
interface Lead {
    id: string;
    companyName: string;
    founderName: string;
    email: string;
    status: "new" | "contacted" | "meeting" | "closed" | "lost";
    score?: number;
    source?: string;
    value?: number;
    lastContact?: unknown;
}

const COLUMNS = {
    new: { id: "new", title: "New Leads", color: "bg-blue-500/10 text-blue-500" },
    contacted: { id: "contacted", title: "Contacted", color: "bg-yellow-500/10 text-yellow-500" },
    meeting: { id: "meeting", title: "Meeting Booked", color: "bg-purple-500/10 text-purple-500" },
    closed: { id: "closed", title: "Closed Won", color: "bg-green-500/10 text-green-500" },
};

export default function CRMPage() {
    const { user } = useAuth();
    const [leads, setLeads] = useState<Lead[]>([]);
    const [isClient, setIsClient] = useState(false); // Fix hydration for dnd

    // New Lead Form State
    const [newLeadOpen, setNewLeadOpen] = useState(false);
    const [newLeadData, setNewLeadData] = useState({ companyName: "", founderName: "", email: "" });

    useEffect(() => {
        setIsClient(true);
        if (!user) return;

        // Listen for leads
        // Note: We need to create a 'leads' collection or use existing lead runs data
        // For this demo, we'll assume a 'leads' collection exists linked to user
        const q = query(collection(db, "leads"), where("userId", "==", user.uid));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const loadedLeads: Lead[] = [];
            snapshot.forEach((doc) => {
                loadedLeads.push({ id: doc.id, ...doc.data() } as Lead);
            });
            setLeads(loadedLeads);
        });

        return () => unsubscribe();
    }, [user]);

    // Handle Drag End
    const onDragEnd = async (result: DropResult) => {
        const { destination, source, draggableId } = result;

        if (!destination) return;
        if (destination.droppableId === source.droppableId && destination.index === source.index) return;

        // Optimistic Update
        const updatedLeads = leads.map(lead => {
            if (lead.id === draggableId) {
                return { ...lead, status: destination.droppableId as Lead['status'] };
            }
            return lead;
        });
        setLeads(updatedLeads);

        // Update Firestore
        try {
            const leadRef = doc(db, "leads", draggableId);
            await updateDoc(leadRef, { status: destination.droppableId });
            toast.success("Lead status updated");
        } catch (error) {
            console.error("Failed to update status", error);
            toast.error("Failed to move lead");
        }
    };

    const handleCreateLead = async () => {
        if (!user || !newLeadData.companyName) return;
        try {
            await addDoc(collection(db, "leads"), {
                ...newLeadData,
                userId: user.uid,
                status: "new",
                createdAt: new Date()
            });
            setNewLeadOpen(false);
            setNewLeadData({ companyName: "", founderName: "", email: "" });
            toast.success("Lead created");
        } catch (_e) {
            toast.error("Error creating lead");
        }
    };

    if (!isClient) return null; // Avoid hydration mismatch for DnD

    return (
        <div className="min-h-screen bg-black p-6 md:p-8 overflow-x-auto">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-white">Lead Pipeline</h1>
                    <p className="text-zinc-400">Manage and advance qualified leads</p>
                </div>

                <Dialog open={newLeadOpen} onOpenChange={setNewLeadOpen}>
                    <DialogTrigger asChild>
                        <Button className="bg-white text-black hover:bg-zinc-200">
                            <Plus className="mr-2 h-4 w-4" /> Add Lead
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="bg-zinc-950 border-zinc-800 text-white">
                        <DialogHeader>
                            <DialogTitle>Add New Lead</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4 pt-4">
                            <div className="space-y-2">
                                <Label>Company Name</Label>
                                <Input
                                    value={newLeadData.companyName}
                                    onChange={e => setNewLeadData({ ...newLeadData, companyName: e.target.value })}
                                    className="bg-zinc-900 border-zinc-700"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Founder Name</Label>
                                <Input
                                    value={newLeadData.founderName}
                                    onChange={e => setNewLeadData({ ...newLeadData, founderName: e.target.value })}
                                    className="bg-zinc-900 border-zinc-700"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Email</Label>
                                <Input
                                    value={newLeadData.email}
                                    onChange={e => setNewLeadData({ ...newLeadData, email: e.target.value })}
                                    className="bg-zinc-900 border-zinc-700"
                                />
                            </div>
                            <Button onClick={handleCreateLead} className="w-full">Create Lead</Button>
                        </div>
                    </DialogContent>
                </Dialog>
            </div>

            <DragDropContext onDragEnd={onDragEnd}>
                <div className="flex gap-6 min-w-[1000px]">
                    {Object.entries(COLUMNS).map(([columnId, column]) => (
                        <div key={columnId} className="flex-1 min-w-[280px]">
                            <div className={`flex items-center justify-between mb-4 p-3 rounded-lg border border-white/5 bg-zinc-900/50`}>
                                <span className="font-semibold text-zinc-200">{column.title}</span>
                                <Badge variant="secondary" className="bg-zinc-800 text-zinc-400">
                                    {leads.filter(l => l.status === columnId).length}
                                </Badge>
                            </div>

                            <Droppable droppableId={columnId}>
                                {(provided, snapshot) => (
                                    <div
                                        {...provided.droppableProps}
                                        ref={provided.innerRef}
                                        className={`space-y-3 min-h-[500px] rounded-xl p-2 transition-colors ${snapshot.isDraggingOver ? "bg-zinc-900/30" : "bg-transparent"
                                            }`}
                                    >
                                        {leads
                                            .filter(lead => lead.status === columnId)
                                            .map((lead, index) => (
                                                <Draggable key={lead.id} draggableId={lead.id} index={index}>
                                                    {(provided, snapshot) => (
                                                        <Card
                                                            ref={provided.innerRef}
                                                            {...provided.draggableProps}
                                                            {...provided.dragHandleProps}
                                                            className={`bg-zinc-950 border-zinc-800 hover:border-zinc-700 transition-all ${snapshot.isDragging ? "shadow-2xl ring-2 ring-blue-500/50 rotate-2" : "shadow-sm"
                                                                }`}
                                                        >
                                                            <CardContent className="p-4 space-y-3">
                                                                <div className="flex items-start justify-between gap-2">
                                                                    <div>
                                                                        <h3 className="font-semibold text-white truncate">{lead.companyName}</h3>
                                                                        <p className="text-sm text-zinc-400 truncate">{lead.founderName}</p>
                                                                    </div>
                                                                    {typeof lead.score === "number" && (
                                                                        <Badge variant="secondary" className="bg-zinc-800 text-zinc-300">
                                                                            {lead.score}
                                                                        </Badge>
                                                                    )}
                                                                </div>
                                                                <div className="flex items-center justify-between pt-2 border-t border-zinc-900">
                                                                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                                                                        <Calendar className="h-3 w-3" />
                                                                        <span>Today</span>
                                                                    </div>
                                                                    {lead.email && <MailIcon className="h-3 w-3 text-zinc-600" />}
                                                                </div>
                                                            </CardContent>
                                                        </Card>
                                                    )}
                                                </Draggable>
                                            ))}
                                        {provided.placeholder}
                                    </div>
                                )}
                            </Droppable>
                        </div>
                    ))}
                </div>
            </DragDropContext>
        </div>
    );
}

function MailIcon({ className }: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
        >
            <rect width="20" height="16" x="2" y="4" rx="2" />
            <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
        </svg>
    )
}
