import { useState } from "react";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { useI18n } from "@/i18n/I18nContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
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
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Plus, MoreVertical, Pencil, Trash2, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export default function WorkspaceTabs() {
  const { t } = useI18n();
  const {
    workspaces,
    activeWorkspaceId,
    setActiveWorkspaceId,
    isEnabled,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
    setDefaultWorkspace,
    maxWorkspaces,
  } = useWorkspaces();

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Hide UI entirely for non-premium users
  if (!isEnabled || workspaces.length === 0) return null;

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const ws = await createWorkspace(name);
      setActiveWorkspaceId(ws.id);
      setCreateOpen(false);
      setNewName("");
      toast(t("workspace.created").replace("{name}", name));
    } catch (e: any) {
      toast.error(e?.message ?? t("workspace.createFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleRename = async () => {
    if (!renameId) return;
    const name = renameValue.trim();
    if (!name) return;
    setBusy(true);
    try {
      await renameWorkspace(renameId, name);
      setRenameId(null);
      setRenameValue("");
    } catch (e: any) {
      toast.error(e?.message ?? t("workspace.renameFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setBusy(true);
    try {
      await deleteWorkspace(deleteId);
      setDeleteId(null);
      toast(t("workspace.deleted"));
    } catch (e: any) {
      toast.error(e?.message ?? t("workspace.deleteFailed"));
    } finally {
      setBusy(false);
    }
  };

  const canCreate = workspaces.length < maxWorkspaces;
  const deleting = workspaces.find((w) => w.id === deleteId);

  return (
    <>
      <div className="flex flex-wrap items-center gap-1">
        {workspaces.map((ws) => {
          const active = ws.id === activeWorkspaceId;
          return (
            <div
              key={ws.id}
              className={cn(
                "group flex items-center rounded-lg border transition-colors shrink-0",
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background hover:bg-muted border-border",
              )}
            >
              <button
                type="button"
                onClick={() => setActiveWorkspaceId(ws.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium"
              >
                {ws.is_default && (
                  <Star className={cn("h-3 w-3", active ? "fill-current" : "fill-amber-400 text-amber-400")} />
                )}
                <span className="max-w-[160px] truncate">{ws.name}</span>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "px-1.5 py-1.5 rounded-r-lg",
                      active ? "hover:bg-primary/80" : "hover:bg-muted-foreground/10",
                    )}
                    aria-label={t("workspace.menuAria").replace("{name}", ws.name)}
                  >
                    <MoreVertical className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => {
                      setRenameId(ws.id);
                      setRenameValue(ws.name);
                    }}
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    {t("workspace.rename")}
                  </DropdownMenuItem>
                  {!ws.is_default && (
                    <DropdownMenuItem
                      onClick={async () => {
                        try {
                          await setDefaultWorkspace(ws.id);
                          toast(t("workspace.defaultSet"));
                        } catch (e: any) {
                          toast.error(e?.message ?? t("workspace.error"));
                        }
                      }}
                    >
                      <Star className="mr-2 h-4 w-4" />
                      {t("workspace.makeDefault")}
                    </DropdownMenuItem>
                  )}
                  {!ws.is_default && workspaces.length > 1 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => setDeleteId(ws.id)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        {t("workspace.delete")}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        })}
        {canCreate && (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => setCreateOpen(true)}
            aria-label={t("workspace.add")}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            {t("workspace.add")}
          </Button>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("workspace.createTitle")}</DialogTitle>
            <DialogDescription>{t("workspace.createDescription")}</DialogDescription>
          </DialogHeader>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t("workspace.placeholder")}
            maxLength={60}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
            }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleCreate} disabled={busy || !newName.trim()}>
              {t("workspace.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!renameId} onOpenChange={(o) => !o && setRenameId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("workspace.renameTitle")}</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            maxLength={60}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename();
            }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameId(null)} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleRename} disabled={busy || !renameValue.trim()}>
              {t("workspace.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("workspace.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("workspace.deleteDescription").replace("{name}", deleting?.name ?? "")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={busy} className="bg-destructive hover:bg-destructive/90">
              {t("workspace.deleteConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
