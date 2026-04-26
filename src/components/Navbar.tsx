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
import { LogOut, Shield, Download, Upload, Bug, Sparkles } from "lucide-react";
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
import { exportTodosCsv } from "@/lib/exportCsv";
import { validateCsvFile, importCsvFile } from "@/lib/importCsv";
import { toast } from "@/hooks/use-toast";
import type { Todo } from "@/hooks/useTodos";

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
      const { data, error } = await supabase.functions.invoke("todos-api", { body: { action: "list" } });
      if (error) throw error;
      const { data: archivedData } = await supabase.functions.invoke("todos-api", {
        body: { action: "list_archived", searchText: "", pageSize: 10000, pageOffset: 0 },
      });
      const allTodos = [...(data || []), ...(archivedData || [])] as Todo[];
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
    try {
      const { validTodos, skippedCount } = await importCsvFile(selectedFile);
      if (validTodos.length === 0) {
        toast({ title: t("backup.noValidRows"), variant: "destructive" });
        return;
      }
      await supabase.functions.invoke("todos-api", { body: { action: "delete_all" } });
      await supabase.functions.invoke("todos-api", { body: { action: "bulk_insert", todos: validTodos } });
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
                      aria-label={t("nav.premiumComingSoon") ?? "Coming soon"}
                    >
                      <Sparkles className="h-4 w-4" />
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {t("nav.premiumComingSoon") ?? "Coming soon"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {isAdmin && (
              <Button variant="ghost" size="icon" asChild>
                <Link to="/admin" className="flex items-center gap-1">
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
                <button className="cursor-pointer rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
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
