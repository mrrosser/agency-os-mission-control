"use client";

import type { User } from "firebase/auth";
import { RefreshCcw, Save, Bookmark, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type LeadRunTemplateSummary = {
  templateId: string;
  name: string;
  clientName?: string | null;
};

export function SavedRunTemplates(props: {
  user: User | null;
  templates: LeadRunTemplateSummary[];
  templatesLoading: boolean;
  selectedTemplateId: string;
  onSelectTemplate: (templateId: string) => void;
  onRefreshTemplates: () => void;
  onOpenDialog: () => void;
  onClearSelection: () => void;
  onDeleteSelected: () => void;
  deleting: boolean;
  dialogOpen: boolean;
  onDialogOpenChange: (open: boolean) => void;
  templateName: string;
  onTemplateNameChange: (value: string) => void;
  templateClientName: string;
  onTemplateClientNameChange: (value: string) => void;
  onSaveTemplate: () => void;
  saving: boolean;
}) {
  const hasSelection = Boolean(props.selectedTemplateId);

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium text-zinc-200">Saved Run Templates</Label>
      <div className="flex items-center gap-2">
        <Select
          value={props.selectedTemplateId || undefined}
          onValueChange={props.onSelectTemplate}
          disabled={!props.user || props.templatesLoading}
        >
          <SelectTrigger className="h-11 bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20">
            <SelectValue placeholder={props.templatesLoading ? "Loading templates..." : "Select a template..."} />
          </SelectTrigger>
          <SelectContent className="border-zinc-800 bg-zinc-950 text-zinc-100">
            {props.templates.length === 0 ? (
              <SelectItem value="__empty__" disabled>
                No saved templates
              </SelectItem>
            ) : (
              props.templates.map((t) => (
                <SelectItem key={t.templateId} value={t.templateId}>
                  {t.clientName ? `${t.clientName} - ${t.name}` : t.name}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>

        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={props.onRefreshTemplates}
          disabled={!props.user || props.templatesLoading}
          className="h-11 w-11 border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-white"
          aria-label="Refresh templates"
        >
          <RefreshCcw className={props.templatesLoading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          onClick={props.onOpenDialog}
          disabled={!props.user}
          className="h-9 bg-zinc-900 border border-zinc-700 text-white hover:bg-zinc-800"
        >
          <Save className="h-4 w-4" />
          {hasSelection ? "Update Template" : "Save Template"}
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={props.onClearSelection}
          disabled={!hasSelection}
          className="h-9 border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-white"
        >
          <Bookmark className="h-4 w-4" />
          Clear
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={props.onDeleteSelected}
          disabled={!hasSelection || props.deleting}
          className="h-9 border-red-900 bg-zinc-900 text-red-400 hover:bg-red-950/40 hover:text-red-200"
        >
          <Trash2 className={props.deleting ? "h-4 w-4 animate-pulse" : "h-4 w-4"} />
          Delete
        </Button>
      </div>

      <Dialog open={props.dialogOpen} onOpenChange={props.onDialogOpenChange}>
        <DialogContent className="border-zinc-800 bg-zinc-950 text-zinc-100">
          <DialogHeader>
            <DialogTitle className="text-white">Save Lead Run Template</DialogTitle>
            <DialogDescription className="text-zinc-400">
              Store your run settings so you can re-run them in one click.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-zinc-200">Template Name</Label>
              <Input
                value={props.templateName}
                onChange={(e) => props.onTemplateNameChange(e.target.value)}
                placeholder="e.g. Austin HVAC High Intent"
                className="h-11 bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium text-zinc-200">Client / Org (optional)</Label>
              <Input
                value={props.templateClientName}
                onChange={(e) => props.onTemplateClientNameChange(e.target.value)}
                placeholder="e.g. McCullough, Inc."
                className="h-11 bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => props.onDialogOpenChange(false)}
              className="border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-white"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={props.onSaveTemplate}
              disabled={props.saving}
              className="bg-blue-600 hover:bg-blue-500 text-white"
            >
              {props.saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

