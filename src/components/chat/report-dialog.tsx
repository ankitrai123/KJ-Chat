"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Spinner } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { fromDatabaseError, toUserMessage } from "@/lib/errors";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { reportSchema } from "@/lib/validation/profile";
import type { ReportReason } from "@/types/database";

const REASONS: { value: ReportReason; label: string }[] = [
  { value: "spam", label: "Spam" },
  { value: "harassment", label: "Harassment or bullying" },
  { value: "inappropriate", label: "Inappropriate content" },
  { value: "impersonation", label: "Impersonation" },
  { value: "other", label: "Something else" },
];

export interface ReportTarget {
  userId: string | null;
  messageId: string | null;
  label: string;
}

/** Reports go to the app administrators (see /admin). */
export function ReportDialog({ target, onClose }: { target: ReportTarget | null; onClose: () => void }) {
  const [reason, setReason] = useState<ReportReason>("spam");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!target) return;
    const parsed = reportSchema.safeParse({ reason, details });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check the report details.");
      return;
    }
    setBusy(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.rpc("report_content", {
        p_reported_user_id: target.userId,
        p_message_id: target.messageId,
        p_reason: parsed.data.reason,
        p_details: parsed.data.details || null,
      });
      if (error) throw fromDatabaseError(error, "Could not send the report.");
      toast.success("Report sent. Thank you.");
      setDetails("");
      onClose();
    } catch (e) {
      toast.error(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report {target?.label}</DialogTitle>
          <DialogDescription>The administrators will review it. The person won&apos;t be told who reported them.</DialogDescription>
        </DialogHeader>
        <FormField id="report-reason" label="Reason">
          {(p) => (
            <Select value={reason} onValueChange={(v) => setReason(v as ReportReason)}>
              <SelectTrigger id={p.id}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
        <FormField id="report-details" label="Details (optional)">
          {(p) => <Textarea {...p} value={details} onChange={(e) => setDetails(e.target.value)} maxLength={1000} rows={3} />}
        </FormField>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => void submit()} disabled={busy}>
            {busy && <Spinner label="Sending" />}
            Send report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
