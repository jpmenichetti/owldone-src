import { useEffect, useState, useRef } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { LogOut, Shield, Download, Upload, Bug, Crown, Volume2, VolumeX } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import logo from "@/assets/logo.png";
import LanguageSelector from "@/components/LanguageSelector";
import DevTimeTravel from "@/components/DevTimeTravel";
import { useI18n } from "@/i18n/I18nContext";
import { exportTodosCsv, type ExportableTodo } from "@/lib/exportCsv";
import { validateCsvFile, importCsvFile } from "@/lib/importCsv";
import { planRestore, type BackupWorkspace } from "@/lib/backupRestore";
import { toast } from "@/hooks/use-toast";
import type { Todo } from "@/hooks/useTodos";
import { useSoundEnabled } from "@/hooks/useSoundEnabled";


export default function Navbar() {
  const { user, signOut } = useAuth();
  const { t } = useI18n();
  const [isAdmin, setIsAdmin] = useState(false);
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;
    supabase.functions
      .invoke("user-api", { body: { action: "check_admin" } })
      .then(({ data, error }) => setIsAdmin(!error && !!data?.isAdmin));
  }, [user]);

  const handleExport = async () => {
    try {
      const { data: workspaces, error: wsErr } = await supabase.functions.invoke("user-api", {
        body: { action: "list_workspaces" },
      });
      if (wsErr) throw wsErr;
      const wsList = (workspaces ?? []) as BackupWorkspace[];

      const allTodos: ExportableTodo[] = [];
      for (const ws of wsList) {
        const { data, error } = await supabase.functions.invoke("todos-api", {
          body: { action: "list", workspace_id: ws.id },
        });
        if (error) throw error;
        const { data: archivedData } = await supabase.functions.invoke("todos-api", {
          body: {
            action: "list_archived",
            workspace_id: ws.id,
            searchText: "",
            pageSize: 10000,
            pageOffset: 0,
          },
        });
        for (const todo of [...(data ?? []), ...(archivedData ?? [])] as Todo[]) {
          allTodos.push({ ...todo, workspace_name: ws.name });
        }
      }
      exportTodosCsv(allTodos);
      toast({ title: t("backup.exportSuccess") });
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const validationError = validateCsvFile(file);
    if (validationError) {
      toast({ title: validationError, variant: "destructive" });
      e.target.value = "";
      return;
    }
    setSelectedFile(file);
    setRestoreDialogOpen(true);
    e.target.value = "";
  };

  const handleRestore = async () => {
    if (!selectedFile) return;
    setIsRestoring(true);
    // Fields the backend's bulk_insert action accepts. Anything else is dropped.
    const BULK_FIELDS = [
      "text", "category", "tags", "notes", "urls",
      "completed", "completed_at", "removed", "removed_at", "recurrence",
    ] as const;
    const pickBulkFields = (t: Record<string, unknown>) => {
      const out: Record<string, unknown> = {};
      for (const k of BULK_FIELDS) if (t[k] !== undefined) out[k] = t[k];
      return out;
    };

    // Track what we've deleted so we can restore it if a later step fails.
    const snapshot = new Map<string, Record<string, unknown>[]>();
    const deletedWorkspaceIds: string[] = [];

    const invoke = async (body: Record<string, unknown>, label: string) => {
      const { data, error } = await supabase.functions.invoke("todos-api", { body });
      if (error) {
        const msg =
          (error as { context?: { error?: string } })?.context?.error ||
          (error as Error)?.message ||
          `${label} failed`;
        throw new Error(msg);
      }
      return data;
    };

    const rollback = async () => {
      // Best-effort: re-clear any workspace we touched, then re-insert snapshot rows.
      for (const wsId of deletedWorkspaceIds) {
        try {
          await supabase.functions.invoke("todos-api", {
            body: { action: "delete_all", workspace_id: wsId },
          });
        } catch { /* ignore */ }
        const rows = snapshot.get(wsId) ?? [];
        if (rows.length === 0) continue;
        try {
          await supabase.functions.invoke("todos-api", {
            body: { action: "bulk_insert", workspace_id: wsId, todos: rows },
          });
        } catch { /* ignore — surface primary error */ }
      }
    };

    try {
      const { validTodos, skippedCount } = await importCsvFile(selectedFile);
      if (validTodos.length === 0) {
        toast({ title: t("backup.noValidRows"), variant: "destructive" });
        return;
      }

      // Resolve workspaces: find existing by name, create missing where possible,
      // and fall back to the default workspace for rows without one.
      const { data: wsData, error: wsErr } = await supabase.functions.invoke("user-api", {
        body: { action: "list_workspaces" },
      });
      if (wsErr) throw wsErr;
      const existing = ((wsData ?? []) as BackupWorkspace[]).slice();
      const defaultWs = existing.find((w) => w.is_default) ?? existing[0];
      if (!defaultWs) throw new Error("No workspace available");

      const plan = planRestore(validTodos, existing);
      for (const name of plan.workspacesToCreate) {
        try {
          const { data: created, error } = await supabase.functions.invoke("user-api", {
            body: { action: "create_workspace", name },
          });
          if (!error && created?.id) {
            existing.push({ id: created.id, name: created.name, is_default: false });
          }
        } catch {
          // Best-effort: fall back to default for this name.
        }
      }
      const groups = plan.buildGroups(existing, defaultWs.id);

      // Snapshot every workspace's current tasks (active + archived) before we
      // delete anything, so we can roll back on failure.
      for (const ws of existing) {
        const active = (await invoke(
          { action: "list", workspace_id: ws.id },
          "snapshot",
        )) as Todo[] | null ?? [];
        const archived = (await invoke(
          {
            action: "list_archived",
            workspace_id: ws.id,
            searchText: "",
            pageSize: 10000,
            pageOffset: 0,
          },
          "snapshot",
        )) as Todo[] | null ?? [];
        snapshot.set(
          ws.id,
          [...active, ...archived].map((t) => pickBulkFields(t as unknown as Record<string, unknown>)),
        );
      }

      // Wipe existing data, tracking what we've cleared so rollback can target it.
      for (const ws of existing) {
        await invoke({ action: "delete_all", workspace_id: ws.id }, "delete_all");
        deletedWorkspaceIds.push(ws.id);
      }

      // Insert restored rows; if any batch fails we roll back to the snapshot.
      try {
        for (const [workspaceId, rows] of groups) {
          const payload = rows.map(({ workspace_name: _w, ...rest }) => rest);
          await invoke(
            { action: "bulk_insert", workspace_id: workspaceId, todos: payload },
            "bulk_insert",
          );
        }
      } catch (insertErr) {
        await rollback();
        throw insertErr;
      }

      let msg = t("backup.restoreSuccess").replace("{count}", String(validTodos.length));
      if (skippedCount > 0) {
        msg += ` ${t("backup.skippedRows").replace("{count}", String(skippedCount))}`;
      }
      toast({ title: msg });
      // Force refresh of todo data
      window.location.reload();
    } catch (err: any) {
      toast({ title: err.message || t("backup.restoreError"), variant: "destructive" });
    } finally {
      setIsRestoring(false);
      setRestoreDialogOpen(false);
      setSelectedFile(null);
    }
  };


  return (
    <>
      <header className="sticky top-0 z-40 border-b bg-card/80 backdrop-blur-md">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-2 shrink-0">
            <img src={logo} alt="OwlDone" className="h-8 w-auto shrink-0" />
            <h1 className="hidden sm:block font-display text-2xl font-bold tracking-tight whitespace-nowrap">
              Owl<span className="text-accent">Done</span>
              <span className="sr-only"> — Smart Task Management</span>
            </h1>
          </div>

          <div className="flex items-center gap-1">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0}>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled
                      aria-label={t("nav.premiumComingSoon") ?? "Unlock premium features — coming soon"}
                    >
                      <Crown className="h-4 w-4 text-amber-500" />
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {t("nav.premiumComingSoon") ?? "Unlock premium features — coming soon"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {isAdmin && (
              <Button variant="ghost" size="icon" asChild aria-label={t("nav.adminDashboard")}>
                <Link to="/admin" className="flex items-center gap-1" aria-label={t("nav.adminDashboard")}>
                  <Shield className="h-4 w-4" />
                </Link>
              </Button>
            )}
            {isAdmin && <DevTimeTravel />}
            <LanguageSelector />
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileSelect}
              className="hidden"
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label={t("nav.openUserMenu")} className="cursor-pointer rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={user?.user_metadata?.avatar_url} />
                    <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                      {user?.email?.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={handleExport}>
                  <Download className="mr-2 h-4 w-4" />
                  {t("backup.export")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                  <Upload className="mr-2 h-4 w-4" />
                  {t("backup.import")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <a
                    href="https://github.com/jpmenichetti/owldone-src/issues/new/choose"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Bug className="mr-2 h-4 w-4" />
                    {t("nav.reportIssue") ?? "Report Issue"}
                  </a>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={signOut}>
                  <LogOut className="mr-2 h-4 w-4" />
                  {t("nav.signOut") ?? "Sign Out"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <AlertDialog open={restoreDialogOpen} onOpenChange={setRestoreDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("backup.restoreTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("backup.restoreWarning")}
              {selectedFile && (
                <span className="mt-2 block font-medium text-foreground">
                  {selectedFile.name}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRestoring}>{t("backup.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleRestore} disabled={isRestoring}>
              {isRestoring ? t("backup.restoring") : t("backup.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
