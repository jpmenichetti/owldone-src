import type { WeeklyReport } from "@/hooks/useWeeklyReports";
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from "docx";
import jsPDF from "jspdf";

type Translator = (key: string) => string;

function formatDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString();
}

function weekTitle(report: WeeklyReport, t: Translator): string {
  return t("report.weekOf")
    .replace("{start}", formatDate(report.week_start))
    .replace("{end}", formatDate(report.week_end));
}

function countLine(report: WeeklyReport, t: Translator): string {
  const label = report.todos_count === 1 ? t("todo.taskSingular") : t("todo.taskPlural");
  return `${report.todos_count} ${label}`;
}

function filename(ext: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return `owldone-weekly-reports-${date}.${ext}`;
}

function triggerDownload(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Sort oldest → newest (data comes in newest → oldest)
function sortOldestFirst(reports: WeeklyReport[]): WeeklyReport[] {
  return [...reports].sort((a, b) => a.week_start.localeCompare(b.week_start));
}

export function exportReportsMd(reports: WeeklyReport[], t: Translator): void {
  const sorted = sortOldestFirst(reports);
  const parts: string[] = [`# ${t("report.title")}`, ""];
  for (const r of sorted) {
    parts.push(`## ${weekTitle(r, t)}`);
    parts.push("");
    parts.push(r.summary);
    parts.push("");
    parts.push(`_${countLine(r, t)}_`);
    parts.push("");
  }
  const blob = new Blob([parts.join("\n")], { type: "text/markdown;charset=utf-8;" });
  triggerDownload(blob, filename("md"));
}

export async function exportReportsDocx(reports: WeeklyReport[], t: Translator): Promise<void> {
  const sorted = sortOldestFirst(reports);
  const children: Paragraph[] = [
    new Paragraph({ text: t("report.title"), heading: HeadingLevel.TITLE }),
  ];

  sorted.forEach((r) => {
    children.push(
      new Paragraph({ text: weekTitle(r, t), heading: HeadingLevel.HEADING_1 }),
    );
    // Split summary into paragraphs by blank lines / newlines
    for (const para of r.summary.split(/\n+/)) {
      children.push(new Paragraph({ children: [new TextRun(para)] }));
    }
    children.push(
      new Paragraph({ children: [new TextRun({ text: countLine(r, t), italics: true })] }),
    );
  });

  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  triggerDownload(blob, filename("docx"));
}

export function exportReportsPdf(reports: WeeklyReport[], t: Translator): void {
  const sorted = sortOldestFirst(reports);
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 56;
  const maxWidth = pageWidth - margin * 2;
  const lineHeight = 16;
  let y = margin;

  const ensureSpace = (lines: number) => {
    if (y + lines * lineHeight > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  };

  const writeBlock = (text: string, size: number, style: "bold" | "italic" | "normal") => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    const wrapped = doc.splitTextToSize(text, maxWidth);
    ensureSpace(wrapped.length);
    doc.text(wrapped, margin, y);
    y += wrapped.length * lineHeight;
  };

  writeBlock(t("report.title"), 20, "bold");
  y += lineHeight / 2;

  sorted.forEach((r, idx) => {
    if (idx > 0) {
      doc.addPage();
      y = margin;
    }
    writeBlock(weekTitle(r, t), 16, "bold");
    y += 4;
    writeBlock(r.summary, 12, "normal");
    y += 4;
    writeBlock(countLine(r, t), 10, "italic");
  });

  const blob = doc.output("blob");
  triggerDownload(blob, filename("pdf"));
}
