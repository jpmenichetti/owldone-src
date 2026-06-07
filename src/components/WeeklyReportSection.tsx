import { useState } from "react";
import { useWeeklyReports, WeeklyReport } from "@/hooks/useWeeklyReports";
import { useI18n } from "@/i18n/I18nContext";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ChevronDown, Sparkles, Copy, Check, FileText, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { exportReportsMd, exportReportsDocx, exportReportsPdf } from "@/lib/exportWeeklyReports";

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const { t } = useI18n();

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast(label);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("report.copyFailed"));
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={copied ? t("report.copiedAria") : t("report.copyAria")}
      className="h-7 w-7 text-muted-foreground hover:text-foreground shrink-0"
      onClick={handleCopy}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}

function ReportCard({ report, copiedLabel }: { report: WeeklyReport; copiedLabel: string }) {
  const { t } = useI18n();
  const weekLabel = t("report.weekOf")
    .replace("{start}", new Date(report.week_start + "T00:00:00").toLocaleDateString())
    .replace("{end}", new Date(report.week_end + "T00:00:00").toLocaleDateString());

  return (
    <div className="rounded-lg border bg-background/50 p-3 space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground font-medium">{weekLabel}</span>
        <CopyButton text={report.summary} label={copiedLabel} />
      </div>
      <p className="text-sm text-foreground leading-relaxed">{report.summary}</p>
      <span className="text-[11px] text-muted-foreground">
        {report.todos_count} {report.todos_count === 1 ? t("todo.taskSingular") : t("todo.taskPlural")}
      </span>
    </div>
  );
}

export default function WeeklyReportSection() {
  const { reports, latestReport, generateReport, isGenerating, isLoading } = useWeeklyReports();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [showPast, setShowPast] = useState(false);

  const pastReports = reports.slice(1);

  const handleGenerate = () => {
    generateReport.mutate(undefined, {
      onSuccess: () => toast(t("report.generated"), { duration: 4000 }),
      onError: (err) => {
        if (err.message === "no_tasks") {
          toast(t("report.noTasks"), { duration: 4000 });
        } else if (err.message === "rate_limited") {
          toast.error(t("report.rateLimited"), { duration: 5000 });
        } else {
          toast.error(t("report.generateFailed"), { duration: 5000 });
        }
      },
    });
  };

  if (isLoading) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-xl border bg-muted/50 p-4">
      <CollapsibleTrigger className="flex w-full items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-muted-foreground" />
          <h2 className="font-display text-lg font-semibold text-muted-foreground">
            {t("report.title")}
          </h2>
        </div>
        <ChevronDown
          className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3 space-y-3">
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            disabled={isGenerating}
            onClick={handleGenerate}
          >
            <Sparkles className="h-4 w-4 mr-1.5" />
            {isGenerating ? t("report.generating") : t("report.generate")}
          </Button>
        </div>

        {!latestReport && !isGenerating && (
          <p className="text-sm text-muted-foreground text-center py-4">
            {t("report.noReports")}
          </p>
        )}

        {latestReport && (
          <ReportCard report={latestReport} copiedLabel={t("report.copied")} />
        )}

        {pastReports.length > 0 && (
          <Collapsible open={showPast} onOpenChange={setShowPast}>
            <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <ChevronDown
                className={cn("h-3 w-3 transition-transform", showPast && "rotate-180")}
              />
              {t("report.pastReports")} ({pastReports.length})
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2 space-y-2">
              {pastReports.map((report) => (
                <ReportCard key={report.id} report={report} copiedLabel={t("report.copied")} />
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
