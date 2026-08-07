"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";
import { Calendar, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/components/providers/auth-provider";
import {
  buildAuthHeaders,
  getResponseCorrelationId,
  readApiJson,
} from "@/lib/api/client";
import {
  CRM_PIPELINE_STAGE_ORDER,
  DEFAULT_OFFER_CODE_BY_BUSINESS,
  formatCrmPipelineStageLabel,
  getOffersForBusinessUnit,
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
  phone?: string;
  source?: string;
  businessUnit: BusinessUnitId;
  offerCode: string;
  pipelineStage: CrmPipelineStage;
  lastTimelineAt?: string | null;
  timelineCount: number;
}

interface CustomerListResponse {
  sourceOfTruth: "paperclip" | "firestore_projected";
  customers: Array<{
    customerId: string;
    companyName: string;
    contactName?: string | null;
    email?: string | null;
    phone?: string | null;
    sourceLabel?: string | null;
    businessUnit?: BusinessUnitId;
    offerCode?: string;
    pipelineStage?: CrmPipelineStage;
    lastTimelineAt?: string | null;
    timelineCount?: number;
  }>;
}

interface TimelineEvent {
  eventId: string;
  type: string;
  channel: "email" | "sms" | "voice" | "calendar" | "social" | "pos" | "ads" | "system";
  summary: string;
  detail?: string | null;
  occurredAt?: string | null;
}

interface TimelineResponse {
  sourceOfTruth: "paperclip" | "firestore_projected";
  events: TimelineEvent[];
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

const CHANNEL_COLORS: Record<TimelineEvent["channel"], string> = {
  email: "bg-blue-500/10 text-blue-300",
  sms: "bg-amber-500/10 text-amber-300",
  voice: "bg-purple-500/10 text-purple-300",
  calendar: "bg-cyan-500/10 text-cyan-300",
  social: "bg-pink-500/10 text-pink-300",
  pos: "bg-emerald-500/10 text-emerald-300",
  ads: "bg-orange-500/10 text-orange-300",
  system: "bg-zinc-500/10 text-zinc-300",
};

const STAGE_COLUMNS = CRM_PIPELINE_STAGE_ORDER.map((stage) => ({
  id: stage,
  title: formatCrmPipelineStageLabel(stage),
  color: STAGE_COLORS[stage],
}));

function formatTimelineDate(value: string | null | undefined): string {
  if (!value) return "Pending";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "Pending";
  return new Date(parsed).toLocaleString();
}

function formatBusinessUnitLabel(value: BusinessUnitId): string {
  if (value === "rosser_nft_gallery") return "Rosser Gallery";
  if (value === "rt_solutions") return "RT Solutions";
  return "AI CoFoundry";
}

export default function CRMPage() {
  const { user } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [loadingTimeline, setLoadingTimeline] = useState(false);
  const [sourceOfTruth, setSourceOfTruth] = useState<"paperclip" | "firestore_projected">(
    "firestore_projected"
  );
  const [timelineSource, setTimelineSource] = useState<"paperclip" | "firestore_projected">(
    "firestore_projected"
  );
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const selectedLeadIdRef = useRef<string | null>(null);
  const timelineAbortRef = useRef<AbortController | null>(null);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [updatingLeadId, setUpdatingLeadId] = useState<string | null>(null);
  const [newLeadOpen, setNewLeadOpen] = useState(false);
  const [newLeadData, setNewLeadData] = useState({
    companyName: "",
    founderName: "",
    email: "",
    phone: "",
    businessUnit: "rt_solutions" as BusinessUnitId,
    offerCode: DEFAULT_OFFER_CODE_BY_BUSINESS.rt_solutions,
  });

  const offerOptions = useMemo(
    () => getOffersForBusinessUnit(newLeadData.businessUnit),
    [newLeadData.businessUnit]
  );

  const selectedLead = useMemo(
    () => leads.find((lead) => lead.id === selectedLeadId) || null,
    [leads, selectedLeadId]
  );

  const leadsByStage = useMemo(() => {
    const grouped = Object.fromEntries(
      CRM_PIPELINE_STAGE_ORDER.map((stage) => [stage, [] as Lead[]])
    ) as Record<CrmPipelineStage, Lead[]>;

    for (const lead of leads) {
      grouped[lead.pipelineStage].push(lead);
    }

    return grouped;
  }, [leads]);

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
    void loadCustomers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  useEffect(() => {
    selectedLeadIdRef.current = selectedLeadId;
    if (!user || !selectedLeadId) {
      timelineAbortRef.current?.abort();
      setTimelineEvents([]);
      setLoadingTimeline(false);
      return;
    }
    void loadTimeline(selectedLeadId);
    return () => timelineAbortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, selectedLeadId]);

  async function loadCustomers() {
    if (!user) return;
    setLoadingLeads(true);
    try {
      const headers = await buildAuthHeaders(user);
      const res = await fetch("/api/crm/customers?limit=200", {
        method: "GET",
        headers,
        cache: "no-store",
      });
      const data = await readApiJson<CustomerListResponse & { error?: string }>(res);
      if (!res.ok) {
        const cid = getResponseCorrelationId(res);
        throw new Error(data.error || `Failed to load CRM customers${cid ? ` cid=${cid}` : ""}`);
      }

      const nextLeads = data.customers.map((customer) => ({
        id: customer.customerId,
        companyName: customer.companyName,
        founderName: customer.contactName || "",
        email: customer.email || "",
        phone: customer.phone || "",
        source: customer.sourceLabel || undefined,
        businessUnit: normalizeBusinessUnit(customer.businessUnit),
        offerCode:
          normalizeOfferCode(customer.offerCode) ||
          DEFAULT_OFFER_CODE_BY_BUSINESS[normalizeBusinessUnit(customer.businessUnit)],
        pipelineStage: normalizeCrmPipelineStage(customer.pipelineStage),
        lastTimelineAt: customer.lastTimelineAt || null,
        timelineCount: Number(customer.timelineCount || 0),
      }));

      setLeads(nextLeads);
      setSourceOfTruth(data.sourceOfTruth);
      setSelectedLeadId((current) => {
        if (current && nextLeads.some((lead) => lead.id === current)) return current;
        return nextLeads[0]?.id || null;
      });
    } catch (error) {
      toast.error("Failed to load CRM", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoadingLeads(false);
    }
  }

  async function loadTimeline(customerId: string) {
    if (!user) return;
    timelineAbortRef.current?.abort();
    const controller = new AbortController();
    timelineAbortRef.current = controller;
    setLoadingTimeline(true);
    try {
      const headers = await buildAuthHeaders(user);
      const res = await fetch(`/api/crm/customers/${encodeURIComponent(customerId)}/timeline?limit=50`, {
        method: "GET",
        headers,
        cache: "no-store",
        signal: controller.signal,
      });
      const data = await readApiJson<TimelineResponse & { error?: string }>(res);
      if (controller.signal.aborted || timelineAbortRef.current !== controller) return;
      if (!res.ok) {
        const cid = getResponseCorrelationId(res);
        throw new Error(data.error || `Failed to load customer timeline${cid ? ` cid=${cid}` : ""}`);
      }
      setTimelineEvents(data.events || []);
      setTimelineSource(data.sourceOfTruth);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      toast.error("Failed to load timeline", {
        description: error instanceof Error ? error.message : String(error),
      });
      if (timelineAbortRef.current === controller) setTimelineEvents([]);
    } finally {
      if (timelineAbortRef.current === controller) {
        timelineAbortRef.current = null;
        setLoadingTimeline(false);
      }
    }
  }

  async function updateLeadStage(leadId: string, nextStage: CrmPipelineStage) {
    if (!user || updatingLeadId === leadId) return;

    const currentLead = leads.find((lead) => lead.id === leadId);
    if (!currentLead || currentLead.pipelineStage === nextStage) return;

    const previousStage = currentLead.pipelineStage;
    selectedLeadIdRef.current = leadId;
    setSelectedLeadId(leadId);
    setUpdatingLeadId(leadId);
    setLeads((current) =>
      current.map((lead) => (lead.id === leadId ? { ...lead, pipelineStage: nextStage } : lead))
    );

    try {
      const headers = await buildAuthHeaders(user, {
        idempotencyKey: crypto.randomUUID(),
      });
      const res = await fetch(`/api/crm/customers/${encodeURIComponent(leadId)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          pipelineStage: nextStage,
        }),
      });
      const data = await readApiJson<{ error?: string }>(res);
      if (!res.ok) {
        const cid = getResponseCorrelationId(res);
        throw new Error(data.error || `Failed to update stage${cid ? ` cid=${cid}` : ""}`);
      }
      toast.success("Pipeline stage updated");
      if (selectedLeadIdRef.current === leadId) {
        await loadTimeline(leadId);
      }
    } catch (error) {
      setLeads((current) =>
        current.map((lead) =>
          lead.id === leadId && lead.pipelineStage === nextStage
            ? { ...lead, pipelineStage: previousStage }
            : lead
        )
      );
      toast.error("Failed to move lead", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setUpdatingLeadId((current) => (current === leadId ? null : current));
    }
  }

  const onDragEnd = async (result: DropResult) => {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;

    const nextStage = destination.droppableId as CrmPipelineStage;
    if (!CRM_PIPELINE_STAGE_ORDER.includes(nextStage)) return;
    await updateLeadStage(draggableId, nextStage);
  };

  const handleCreateLead = async () => {
    if (!user || !newLeadData.companyName.trim()) return;
    try {
      const headers = await buildAuthHeaders(user, {
        idempotencyKey: crypto.randomUUID(),
      });
      const res = await fetch("/api/crm/customers", {
        method: "POST",
        headers,
        body: JSON.stringify({
          companyName: newLeadData.companyName.trim(),
          contactName: newLeadData.founderName.trim() || undefined,
          email: newLeadData.email.trim() || undefined,
          phone: newLeadData.phone.trim() || undefined,
          businessUnit: newLeadData.businessUnit,
          offerCode: newLeadData.offerCode,
          pipelineStage: "lead_capture",
        }),
      });
      const data = await readApiJson<{ error?: string }>(res);
      if (!res.ok) {
        const cid = getResponseCorrelationId(res);
        throw new Error(data.error || `Failed to create customer${cid ? ` cid=${cid}` : ""}`);
      }
      setNewLeadOpen(false);
      setNewLeadData({
        companyName: "",
        founderName: "",
        email: "",
        phone: "",
        businessUnit: "rt_solutions",
        offerCode: DEFAULT_OFFER_CODE_BY_BUSINESS.rt_solutions,
      });
      toast.success("Lead created");
      await loadCustomers();
    } catch (error) {
      toast.error("Error creating lead", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <div className="min-h-screen bg-black p-4 sm:p-6 md:p-8">
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Revenue Pipeline</h1>
          <p className="text-zinc-400">
            Customer memory source:{" "}
            <span className="text-zinc-200">
              {sourceOfTruth === "paperclip" ? "Paperclip" : "Projected Firestore fallback"}
            </span>
          </p>
        </div>

        <Dialog open={newLeadOpen} onOpenChange={setNewLeadOpen}>
          <DialogTrigger asChild>
            <Button className="w-full bg-white text-black hover:bg-zinc-200 md:w-auto">
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
                <Label>Contact Name</Label>
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
                <Label>Phone</Label>
                <Input
                  value={newLeadData.phone}
                  onChange={(e) => setNewLeadData({ ...newLeadData, phone: e.target.value })}
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
                    <SelectItem value="rosser_nft_gallery">Rosser Gallery</SelectItem>
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

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-xl border border-zinc-900 bg-zinc-950/30 p-3 md:overflow-x-auto">
          {loadingLeads ? (
            <div className="flex min-h-[320px] items-center justify-center text-sm text-zinc-500">
              Loading CRM customers...
            </div>
          ) : (
            <>
              <div className="space-y-3 md:hidden" data-testid="crm-mobile-list">
                <div className="flex items-center justify-between px-1 pb-1">
                  <div>
                    <h2 className="text-sm font-semibold text-white">Customers</h2>
                    <p className="text-xs text-zinc-500">Update a stage from any phone.</p>
                  </div>
                  <Badge variant="secondary" className="bg-zinc-800 text-zinc-300">
                    {leads.length}
                  </Badge>
                </div>

                {leads.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-zinc-800 px-4 py-10 text-center text-sm text-zinc-500">
                    No CRM customers yet.
                  </p>
                ) : (
                  leads.map((lead) => {
                    const isSelected = lead.id === selectedLeadId;
                    const isUpdating = lead.id === updatingLeadId;
                    return (
                      <Card
                        key={lead.id}
                        className={`border-zinc-800 bg-zinc-950 ${
                          isSelected ? "border-blue-500/50 ring-1 ring-blue-500/40" : ""
                        }`}
                      >
                        <CardContent className="space-y-4 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <h3 className="truncate font-semibold text-white">{lead.companyName}</h3>
                              <p className="truncate text-sm text-zinc-400">
                                {lead.founderName || "No contact name"}
                              </p>
                            </div>
                            <Badge variant="secondary" className="shrink-0 bg-zinc-800 text-zinc-300">
                              {lead.timelineCount}
                            </Badge>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <Badge className={STAGE_COLORS[lead.pipelineStage]}>
                              {formatCrmPipelineStageLabel(lead.pipelineStage)}
                            </Badge>
                            <Badge variant="outline" className="border-zinc-700 text-zinc-300">
                              {lead.offerCode}
                            </Badge>
                          </div>

                          <label className="block space-y-2 text-xs font-medium text-zinc-300">
                            <span>Pipeline stage</span>
                            <select
                              aria-label={`Pipeline stage for ${lead.companyName}`}
                              value={lead.pipelineStage}
                              disabled={isUpdating}
                              onChange={(event) =>
                                void updateLeadStage(lead.id, event.target.value as CrmPipelineStage)
                              }
                              className="h-11 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 disabled:cursor-wait disabled:opacity-60"
                            >
                              {STAGE_COLUMNS.map((stage) => (
                                <option key={stage.id} value={stage.id}>
                                  {stage.title}
                                </option>
                              ))}
                            </select>
                          </label>

                          <div className="flex items-center justify-between gap-3 border-t border-zinc-900 pt-3">
                            <div className="flex min-w-0 items-center gap-2 text-xs text-zinc-500">
                              <Calendar className="h-3 w-3 shrink-0" aria-hidden="true" />
                              <span className="truncate">{formatBusinessUnitLabel(lead.businessUnit)}</span>
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              aria-pressed={isSelected}
                              onClick={() => setSelectedLeadId(lead.id)}
                              className="shrink-0 border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800 hover:text-white"
                            >
                              {isSelected ? "Timeline selected" : "View timeline"}
                            </Button>
                          </div>
                          {isUpdating ? (
                            <p className="text-xs text-cyan-300" role="status">
                              Updating pipeline stage...
                            </p>
                          ) : null}
                        </CardContent>
                      </Card>
                    );
                  })
                )}
              </div>

              <div className="hidden md:block" data-testid="crm-desktop-board">
                <DragDropContext onDragEnd={onDragEnd}>
                  <div className="flex min-w-[1260px] gap-6" aria-label="CRM pipeline drag board">
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
                                    {(dragProvided, dragSnapshot) => {
                                      const isSelected = lead.id === selectedLeadId;
                                      return (
                                        <Card
                                          ref={dragProvided.innerRef}
                                          {...dragProvided.draggableProps}
                                          {...dragProvided.dragHandleProps}
                                          onClick={() => setSelectedLeadId(lead.id)}
                                          className={`cursor-pointer border-zinc-800 bg-zinc-950 transition-all ${
                                            dragSnapshot.isDragging
                                              ? "rotate-2 shadow-2xl ring-2 ring-blue-500/50"
                                              : isSelected
                                                ? "border-blue-500/50 shadow-lg ring-1 ring-blue-500/40"
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
                                              <Badge
                                                variant="secondary"
                                                className="bg-zinc-800 text-zinc-300"
                                              >
                                                {lead.timelineCount}
                                              </Badge>
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                              <Badge className={STAGE_COLORS[lead.pipelineStage]}>
                                                {formatCrmPipelineStageLabel(lead.pipelineStage)}
                                              </Badge>
                                              <Badge
                                                variant="outline"
                                                className="border-zinc-700 text-zinc-300"
                                              >
                                                {lead.offerCode}
                                              </Badge>
                                            </div>
                                            <div className="flex items-center justify-between border-t border-zinc-900 pt-2">
                                              <div className="flex items-center gap-2 text-xs text-zinc-500">
                                                <Calendar className="h-3 w-3" aria-hidden="true" />
                                                <span>{formatBusinessUnitLabel(lead.businessUnit)}</span>
                                              </div>
                                              {lead.email ? (
                                                <MailIcon className="h-3 w-3 text-zinc-500" />
                                              ) : (
                                                <span className="text-[11px] text-zinc-600">no email</span>
                                              )}
                                            </div>
                                          </CardContent>
                                        </Card>
                                      );
                                    }}
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
            </>
          )}
        </div>

        <Card className="border-zinc-800 bg-zinc-950">
          <CardContent className="space-y-4 p-4">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-white">Customer Timeline</h2>
              <p className="text-xs text-zinc-400">
                Source: {timelineSource === "paperclip" ? "Paperclip" : "Projected Firestore fallback"}
              </p>
            </div>

            {selectedLead ? (
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                <p className="text-sm font-semibold text-white">{selectedLead.companyName}</p>
                <p className="text-xs text-zinc-400">{selectedLead.founderName || "No contact name"}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge className={STAGE_COLORS[selectedLead.pipelineStage]}>
                    {formatCrmPipelineStageLabel(selectedLead.pipelineStage)}
                  </Badge>
                  <Badge variant="outline" className="border-zinc-700 text-zinc-300">
                    {selectedLead.offerCode}
                  </Badge>
                </div>
                <div className="mt-3 space-y-1 text-xs text-zinc-500">
                  <p>{selectedLead.email || "No email on file"}</p>
                  <p>{selectedLead.phone || "No phone on file"}</p>
                  <p>Last activity: {formatTimelineDate(selectedLead.lastTimelineAt)}</p>
                </div>
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-zinc-800 px-3 py-6 text-center text-sm text-zinc-500">
                Select a customer to inspect timeline state.
              </p>
            )}

            <div className="space-y-3">
              {loadingTimeline ? (
                <p className="text-sm text-zinc-500">Loading timeline...</p>
              ) : timelineEvents.length === 0 ? (
                <p className="text-sm text-zinc-500">No customer-linked activity yet.</p>
              ) : (
                timelineEvents.map((event) => (
                  <div
                    key={event.eventId}
                    className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="text-sm text-white">{event.summary}</p>
                        {event.detail ? (
                          <p className="text-xs text-zinc-400">{event.detail}</p>
                        ) : null}
                      </div>
                      <Badge className={CHANNEL_COLORS[event.channel]}>{event.channel}</Badge>
                    </div>
                    <p className="mt-2 text-[11px] text-zinc-500">
                      {formatTimelineDate(event.occurredAt)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
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
