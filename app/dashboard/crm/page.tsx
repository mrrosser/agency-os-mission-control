"use client";

import { useEffect, useMemo, useState } from "react";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";
import { Plus, Calendar } from "lucide-react";
import { collection, query, where, onSnapshot, doc, updateDoc, addDoc } from "firebase/firestore";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/components/providers/auth-provider";
import { db } from "@/lib/firebase";
import {
    CRM_PIPELINE_STAGE_ORDER,
    DEFAULT_OFFER_CODE_BY_BUSINESS,
    formatCrmPipelineStageLabel,
    getOffersForBusinessUnit,
    legacyStatusFromPipelineStage,
    normalizeBusinessUnit,
    normalizeCrmPipelineStage,
    normalizeOfferCode,
    type BusinessUnitId,
    type CrmPipelineStage,
} from "@/lib/revenue/offers";
import { toast } from "sonner";

interface Lead {
    id: string;
    companyName: string;
    founderName?: string;
    email?: string;
    score?: number;
    source?: string;
    value?: number;
    businessUnit: BusinessUnitId;
    offerCode: string;
    pipelineStage: CrmPipelineStage;
}

const STAGE_COLORS: Record<CrmPipelineStage, string> = {
    lead_capture: "bg-blue-500/10 text-blue-400",
    qualification: "bg-cyan-500/10 text-cyan-300",
    outreach: "bg-amber-500/10 text-amber-300",
    booking: "bg-purple-500/10 text-purple-300",
    proposal: "bg-indigo-500/10 text-indigo-300",
    deposit_received: "bg-emerald-500/10 text-emerald-300",
    won: "bg-green-500/10 text-green-400",
    lost: "bg-zinc-500/10 text-zinc-400",
};

const STAGE_COLUMNS = CRM_PIPELINE_STAGE_ORDER.map((stage) => ({
    id: stage,
    title: formatCrmPipelineStageLabel(stage),
    color: STAGE_COLORS[stage],
}));

export default function CRMPage() {
    const { user } = useAuth();
    const [leads, setLeads] = useState<Lead[]>([]);
    const [newLeadOpen, setNewLeadOpen] = useState(false);
    const [newLeadData, setNewLeadData] = useState({
        companyName: "",
        founderName: "",
        email: "",
        businessUnit: "rt_solutions" as BusinessUnitId,
        offerCode: DEFAULT_OFFER_CODE_BY_BUSINESS.rt_solutions,
    });

    const offerOptions = useMemo(
        () => getOffersForBusinessUnit(newLeadData.businessUnit),
        [newLeadData.businessUnit]
    );

    useEffect(() => {
        const normalized = normalizeOfferCode(newLeadData.offerCode);
        const hasOffer = offerOptions.some((offer) => offer.code === normalized);
        if (hasOffer) return;
        setNewLeadData((prev) => ({
            ...prev,
            offerCode: DEFAULT_OFFER_CODE_BY_BUSINESS[prev.businessUnit],
        }));
    }, [newLeadData.offerCode, offerOptions]);

    useEffect(() => {
        if (!user) return;
        const q = query(collection(db, "leads"), where("userId", "==", user.uid));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const loadedLeads: Lead[] = snapshot.docs.map((snap) => {
                const data = snap.data() as Record<string, unknown>;
                const businessUnit = normalizeBusinessUnit(data.businessUnit);
                const pipelineStage = normalizeCrmPipelineStage(data.pipelineStage || data.status);
                const offerCode =
                    normalizeOfferCode(data.offerCode) || DEFAULT_OFFER_CODE_BY_BUSINESS[businessUnit];
                return {
                    id: snap.id,
                    companyName: String(data.companyName || data.company || "Untitled Lead"),
                    founderName: typeof data.founderName === "string" ? data.founderName : "",
                    email: typeof data.email === "string" ? data.email : "",
                    score: Number.isFinite(Number(data.score)) ? Number(data.score) : undefined,
                    source: typeof data.source === "string" ? data.source : undefined,
                    value: Number.isFinite(Number(data.value)) ? Number(data.value) : undefined,
                    businessUnit,
                    offerCode,
                    pipelineStage,
                };
            });
            setLeads(loadedLeads);
        });
        return () => unsubscribe();
    }, [user]);

    const leadsByStage = useMemo(() => {
        const grouped = Object.fromEntries(
            CRM_PIPELINE_STAGE_ORDER.map((stage) => [stage, [] as Lead[]])
        ) as Record<CrmPipelineStage, Lead[]>;

        for (const lead of leads) {
            grouped[lead.pipelineStage].push(lead);
        }

        return grouped;
    }, [leads]);

    const onDragEnd = async (result: DropResult) => {
        const { destination, source, draggableId } = result;
        if (!destination) return;
        if (destination.droppableId === source.droppableId && destination.index === source.index) return;

        const nextStage = destination.droppableId as CrmPipelineStage;
        const updatedLeads = leads.map((lead) =>
            lead.id === draggableId ? { ...lead, pipelineStage: nextStage } : lead
        );
        setLeads(updatedLeads);

        try {
            const leadRef = doc(db, "leads", draggableId);
            await updateDoc(leadRef, {
                pipelineStage: nextStage,
                status: legacyStatusFromPipelineStage(nextStage),
                updatedAt: new Date(),
            });
            toast.success("Pipeline stage updated");
        } catch (error) {
            console.error("Failed to update lead stage", error);
            toast.error("Failed to move lead");
        }
    };

    const handleCreateLead = async () => {
        if (!user || !newLeadData.companyName.trim()) return;
        const stage: CrmPipelineStage = "lead_capture";
        const businessUnit = normalizeBusinessUnit(newLeadData.businessUnit);
        const offerCode =
            normalizeOfferCode(newLeadData.offerCode) || DEFAULT_OFFER_CODE_BY_BUSINESS[businessUnit];
        try {
            await addDoc(collection(db, "leads"), {
                companyName: newLeadData.companyName.trim(),
                founderName: newLeadData.founderName.trim(),
                email: newLeadData.email.trim(),
                userId: user.uid,
                businessUnit,
                offerCode,
                pipelineStage: stage,
                status: legacyStatusFromPipelineStage(stage),
                createdAt: new Date(),
            });
            setNewLeadOpen(false);
            setNewLeadData({
                companyName: "",
                founderName: "",
                email: "",
                businessUnit: "rt_solutions",
                offerCode: DEFAULT_OFFER_CODE_BY_BUSINESS.rt_solutions,
            });
            toast.success("Lead created");
        } catch (_e) {
            toast.error("Error creating lead");
        }
    };

    return (
        <div className="min-h-screen overflow-x-auto bg-black p-6 md:p-8">
            <div className="mb-8 flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-white">Revenue Pipeline</h1>
                    <p className="text-zinc-400">Shared stage schema + offer-coded lead tracking</p>
                </div>

                <Dialog open={newLeadOpen} onOpenChange={setNewLeadOpen}>
                    <DialogTrigger asChild>
                        <Button className="bg-white text-black hover:bg-zinc-200">
                            <Plus className="mr-2 h-4 w-4" /> Add Lead
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="border-zinc-800 bg-zinc-950 text-white">
                        <DialogHeader>
                            <DialogTitle>Add New Lead</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4 pt-4">
                            <div className="space-y-2">
                                <Label>Company Name</Label>
                                <Input
                                    value={newLeadData.companyName}
                                    onChange={(e) => setNewLeadData({ ...newLeadData, companyName: e.target.value })}
                                    className="border-zinc-700 bg-zinc-900"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Founder Name</Label>
                                <Input
                                    value={newLeadData.founderName}
                                    onChange={(e) => setNewLeadData({ ...newLeadData, founderName: e.target.value })}
                                    className="border-zinc-700 bg-zinc-900"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Email</Label>
                                <Input
                                    value={newLeadData.email}
                                    onChange={(e) => setNewLeadData({ ...newLeadData, email: e.target.value })}
                                    className="border-zinc-700 bg-zinc-900"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Business Unit</Label>
                                <Select
                                    value={newLeadData.businessUnit}
                                    onValueChange={(value) =>
                                        setNewLeadData({
                                            ...newLeadData,
                                            businessUnit: normalizeBusinessUnit(value),
                                        })
                                    }
                                >
                                    <SelectTrigger className="border-zinc-700 bg-zinc-900">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="border-zinc-800 bg-zinc-950 text-zinc-100">
                                        <SelectItem value="rt_solutions">RT Solutions</SelectItem>
                                        <SelectItem value="rosser_nft_gallery">Rosser NFT Gallery</SelectItem>
                                        <SelectItem value="ai_cofoundry">AI CoFoundry</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Offer Package</Label>
                                <Select
                                    value={normalizeOfferCode(newLeadData.offerCode)}
                                    onValueChange={(value) => setNewLeadData({ ...newLeadData, offerCode: value })}
                                >
                                    <SelectTrigger className="border-zinc-700 bg-zinc-900">
                                        <SelectValue placeholder="Select offer" />
                                    </SelectTrigger>
                                    <SelectContent className="border-zinc-800 bg-zinc-950 text-zinc-100">
                                        {offerOptions.map((offer) => (
                                            <SelectItem key={offer.code} value={offer.code}>
                                                {offer.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <Button onClick={handleCreateLead} className="w-full">
                                Create Lead
                            </Button>
                        </div>
                    </DialogContent>
                </Dialog>
            </div>

            <DragDropContext onDragEnd={onDragEnd}>
                <div className="flex min-w-[1260px] gap-6">
                    {STAGE_COLUMNS.map((column) => {
                        const stageId = column.id as CrmPipelineStage;
                        const stageLeads = leadsByStage[stageId];
                        return (
                            <div key={column.id} className="min-w-[280px] flex-1">
                                <div className="mb-4 flex items-center justify-between rounded-lg border border-white/5 bg-zinc-900/50 p-3">
                                    <span className="font-semibold text-zinc-200">{column.title}</span>
                                    <Badge variant="secondary" className="bg-zinc-800 text-zinc-400">
                                        {stageLeads.length}
                                    </Badge>
                                </div>

                                <Droppable droppableId={column.id}>
                                    {(provided, snapshot) => (
                                        <div
                                            {...provided.droppableProps}
                                            ref={provided.innerRef}
                                            className={`min-h-[500px] space-y-3 rounded-xl p-2 transition-colors ${
                                                snapshot.isDraggingOver ? "bg-zinc-900/30" : "bg-transparent"
                                            }`}
                                        >
                                            {stageLeads.map((lead, index) => (
                                                <Draggable key={lead.id} draggableId={lead.id} index={index}>
                                                    {(dragProvided, dragSnapshot) => (
                                                        <Card
                                                            ref={dragProvided.innerRef}
                                                            {...dragProvided.draggableProps}
                                                            {...dragProvided.dragHandleProps}
                                                            className={`border-zinc-800 bg-zinc-950 transition-all ${
                                                                dragSnapshot.isDragging
                                                                    ? "rotate-2 shadow-2xl ring-2 ring-blue-500/50"
                                                                    : "shadow-sm hover:border-zinc-700"
                                                            }`}
                                                        >
                                                            <CardContent className="space-y-3 p-4">
                                                                <div className="flex items-start justify-between gap-2">
                                                                    <div className="min-w-0">
                                                                        <h3 className="truncate font-semibold text-white">
                                                                            {lead.companyName}
                                                                        </h3>
                                                                        <p className="truncate text-sm text-zinc-400">
                                                                            {lead.founderName || "No contact name"}
                                                                        </p>
                                                                    </div>
                                                                    {typeof lead.score === "number" && (
                                                                        <Badge variant="secondary" className="bg-zinc-800 text-zinc-300">
                                                                            {lead.score}
                                                                        </Badge>
                                                                    )}
                                                                </div>
                                                                <div className="flex flex-wrap gap-2">
                                                                    <Badge className={STAGE_COLORS[lead.pipelineStage]}>
                                                                        {formatCrmPipelineStageLabel(lead.pipelineStage)}
                                                                    </Badge>
                                                                    <Badge variant="outline" className="border-zinc-700 text-zinc-300">
                                                                        {lead.offerCode}
                                                                    </Badge>
                                                                </div>
                                                                <div className="flex items-center justify-between border-t border-zinc-900 pt-2">
                                                                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                                                                        <Calendar className="h-3 w-3" />
                                                                        <span>{lead.businessUnit.replaceAll("_", " ")}</span>
                                                                    </div>
                                                                    {lead.email ? (
                                                                        <MailIcon className="h-3 w-3 text-zinc-500" />
                                                                    ) : (
                                                                        <span className="text-[11px] text-zinc-600">no email</span>
                                                                    )}
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
                        );
                    })}
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
    );
}
