import { useState, useRef, useEffect, useCallback } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, Plus, Upload, Link2, ExternalLink, Trash2, GripVertical, Loader2, Lock } from "lucide-react";
import { Todo, TodoCategory, CATEGORY_CONFIG, getImageUrl } from "@/hooks/useTodos";
import { cn } from "@/lib/utils";
import { tagColor } from "@/lib/tagColors";
import { Tables } from "@/integrations/supabase/types";
...
type Props = {
  todo: Todo | null;
  open: boolean;
  onClose: () => void;
  onUpdate: (id: string, updates: Partial<Todo>) => void;
  onUploadImage: (todoId: string, file: File) => void;
  onDeleteImage: (id: string, storagePath: string) => void;
  isUploading?: boolean;
  readOnly?: boolean;
  allTags?: string[];
  recurrenceEnabled?: boolean;
  recurrenceResolved?: boolean;
};
...
function RecurrenceSection({ todo, onUpdate, readOnly, t, recurrenceEnabled = false }: { todo: Todo; onUpdate: (id: string, updates: Partial<Todo>) => void; readOnly?: boolean; t: (key: string) => string; recurrenceEnabled?: boolean }) {
  if (readOnly) return null;

  const showLocked = !recurrenceEnabled;

  const setRecurrence = (value: string) => {
    if (todo.recurrence === value) {
      onUpdate(todo.id, { recurrence: null, next_recurrence_at: null } as any);
    } else {
      onUpdate(todo.id, { recurrence: value, next_recurrence_at: computeNextRecurrence(value) } as any);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t("detail.recurrence")}</label>
        {showLocked && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Lock className="h-3 w-3 text-muted-foreground cursor-help translate-y-[0.5px]" />
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>{t("detail.recurrenceLocked")}</p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      {recurrenceEnabled && (
        <div className="flex gap-2">
          {RECURRENCE_OPTIONS.map((opt) => (
            <Button
              key={opt}
              size="sm"
              variant={todo.recurrence === opt ? "default" : "outline"}
              onClick={() => setRecurrence(opt)}
              className="flex-1"
            >
              {t(`detail.${opt}`)}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TodoDetailDialog({ todo, open, onClose, onUpdate, onUploadImage, onDeleteImage, isUploading, readOnly, allTags = [] }: Props) {
  const { t } = useI18n();
  const [tagInput, setTagInput] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [localNotes, setLocalNotes] = useState(todo?.notes || "");
  const [localTitle, setLocalTitle] = useState(todo?.text || "");
  const [panelWidth, setPanelWidth] = useState(loadWidth);
  const [isResizing, setIsResizing] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ src: string; alt: string } | null>(null);
  const [pendingPreviews, setPendingPreviews] = useState<{ id: string; blobUrl: string; fileName: string }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const isSavingNotes = useRef(false);

  const prevTodoId = useRef(todo?.id);
  const prevImageCount = useRef(todo?.images?.length ?? 0);
  useEffect(() => {
    if (todo?.id !== prevTodoId.current) {
      setLocalNotes(todo?.notes || "");
      setLocalTitle(todo?.text || "");
      prevTodoId.current = todo?.id;
      isSavingNotes.current = false;
      setPendingPreviews([]);
    }
  }, [todo?.id, todo?.notes]);

  // Clear pending previews when server images update (new image arrived from refetch)
  useEffect(() => {
    const currentCount = todo?.images?.length ?? 0;
    if (currentCount > prevImageCount.current && pendingPreviews.length > 0) {
      setPendingPreviews((prev) => {
        // Remove oldest preview(s) matching the number of new server images
        const newImages = currentCount - prevImageCount.current;
        const remaining = prev.slice(newImages);
        // Revoke blob URLs for removed previews
        prev.slice(0, newImages).forEach((p) => URL.revokeObjectURL(p.blobUrl));
        return remaining;
      });
    }
    prevImageCount.current = currentCount;
  }, [todo?.images?.length]);

  const debouncedUpdateNotes = useCallback((id: string, value: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onUpdate(id, { notes: value });
    }, 500);
  }, [onUpdate]);

  // Resize logic
  const handleResizeStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setIsResizing(true);

    const onMove = (ev: MouseEvent | TouchEvent) => {
      const clientX = "touches" in ev ? ev.touches[0].clientX : ev.clientX;
      setPanelWidth(clampWidth(window.innerWidth - clientX));
    };

    const onEnd = () => {
      setIsResizing(false);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onEnd);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      // Save on end
      setPanelWidth((w) => {
        try { localStorage.setItem(STORAGE_KEY, String(w)); } catch {}
        return w;
      });
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onEnd);
    document.addEventListener("touchmove", onMove);
    document.addEventListener("touchend", onEnd);
  }, []);

  if (!todo) return null;

  const config = CATEGORY_CONFIG[todo.category as TodoCategory];

  const addTag = () => {
    const tag = tagInput.trim();
    if (!tag || todo.tags?.includes(tag)) return;
    onUpdate(todo.id, { tags: [...(todo.tags || []), tag] });
    setTagInput("");
  };

  const removeTag = (tag: string) => {
    onUpdate(todo.id, { tags: (todo.tags || []).filter((t) => t !== tag) });
  };

  const addUrl = () => {
    const url = urlInput.trim();
    if (!url) return;
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        toast.error("Only HTTP and HTTPS URLs are allowed");
        return;
      }
    } catch {
      toast.error("Invalid URL format");
      return;
    }
    onUpdate(todo.id, { urls: [...(todo.urls || []), url] });
    setUrlInput("");
  };

  const removeUrl = (url: string) => {
    onUpdate(todo.id, { urls: (todo.urls || []).filter((u) => u !== url) });
  };

  const addPendingPreview = (file: File) => {
    const blobUrl = URL.createObjectURL(file);
    setPendingPreviews((prev) => [...prev, { id: crypto.randomUUID(), blobUrl, fileName: file.name }]);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      addPendingPreview(file);
      onUploadImage(todo.id, file);
      e.target.value = "";
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/50 transition-opacity duration-300",
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={cn(
          "fixed top-0 right-0 z-50 h-full bg-background border-l shadow-xl flex transition-transform duration-300 ease-in-out",
          open ? "translate-x-0" : "translate-x-full",
          isResizing && "transition-none select-none"
        )}
        style={{ width: window.innerWidth < 640 ? "100%" : panelWidth }}
      >
        {/* Resize handle - hidden on mobile */}
        <div
          className="hidden sm:flex items-center justify-center w-2 cursor-col-resize hover:bg-accent/50 active:bg-accent shrink-0 group"
          onMouseDown={handleResizeStart}
          onTouchStart={handleResizeStart}
        >
          <GripVertical className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>

        {/* Content */}
        <div
          className={cn("flex-1 overflow-y-auto p-6 min-w-0 relative", isDraggingFile && "ring-2 ring-primary ring-inset")}
          onDragOver={(e) => {
            if (readOnly) return;
            e.preventDefault();
            e.stopPropagation();
            setIsDraggingFile(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDraggingFile(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDraggingFile(false);
            if (readOnly || !todo) return;
            const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
            files.forEach((file) => { addPendingPreview(file); onUploadImage(todo.id, file); });
          }}
        >
          {isDraggingFile && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 rounded pointer-events-none">
              <div className="flex flex-col items-center gap-2 text-primary">
                <Upload className="h-8 w-8" />
                <span className="text-sm font-medium">{t("detail.dropImage")}</span>
              </div>
            </div>
          )}
          {/* Header */}
          <div className="flex items-start justify-between mb-4">
            <div className="flex flex-col gap-1.5 min-w-0 flex-1">
              <div className="flex items-center gap-2 font-display">
                <span>{config.emoji}</span>
                <span className={cn("text-sm font-medium px-2 py-0.5 rounded-full", config.bgClass, config.colorClass)}>
                  {t(CATEGORY_LABEL_KEYS[todo.category as TodoCategory] || "category.others")}
                </span>
              </div>
              {readOnly ? (
                <p className="text-base font-medium text-foreground">{todo.text}</p>
              ) : (
                <input
                  value={localTitle}
                  onChange={(e) => setLocalTitle(e.target.value)}
                  onBlur={() => {
                    const trimmed = localTitle.trim();
                    if (trimmed && trimmed !== todo.text) {
                      onUpdate(todo.id, { text: trimmed });
                    } else {
                      setLocalTitle(todo.text);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  className="text-base font-medium text-foreground bg-transparent border-none outline-none w-full focus:ring-1 focus:ring-ring rounded px-0"
                />
              )}
            </div>
            <button onClick={onClose} className="rounded-sm p-1 opacity-70 hover:opacity-100 transition-opacity">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </button>
          </div>

          <div className="space-y-5">
            {/* Tags */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t("detail.tags")}</label>
              <div className="flex flex-wrap gap-1.5">
                {todo.tags?.map((tag) => (
                  <span key={tag} className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold", tagColor(tag))}>
                    {tag}
                    {!readOnly && (
                      <button onClick={() => removeTag(tag)} className="ml-0.5 hover:opacity-60">
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            {!readOnly && (
              <div className="relative">
                <div className="flex gap-2">
                  <Input
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); addTag(); }
                    }}
                    placeholder={t("detail.addTag")}
                    className="h-8 text-sm"
                  />
                  <Button size="sm" variant="outline" onClick={addTag} disabled={!tagInput.trim()}>
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {tagInput.trim() && (() => {
                  const suggestions = allTags.filter(
                    (t) => t.toLowerCase().includes(tagInput.trim().toLowerCase()) && !todo.tags?.includes(t)
                  );
                  if (suggestions.length === 0) return null;
                  return (
                    <div className="absolute z-10 top-full left-0 mt-1 w-full max-h-32 overflow-y-auto rounded-md border bg-popover shadow-md">
                      {suggestions.map((tag) => (
                        <button
                          key={tag}
                          className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent truncate"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            onUpdate(todo.id, { tags: [...(todo.tags || []), tag] });
                            setTagInput("");
                          }}
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t("detail.notes")}</label>
              <Textarea
                value={localNotes}
                onChange={(e) => {
                  setLocalNotes(e.target.value);
                  debouncedUpdateNotes(todo.id, e.target.value);
                }}
                placeholder={t("detail.addNotes")}
                className="min-h-[100px] text-sm"
                readOnly={readOnly}
              />
            </div>

            {/* Images */}
            <div className="space-y-2">
              <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider">{t("detail.images")}</label>
              {((todo.images && todo.images.length > 0) || pendingPreviews.length > 0) && (
                <div className="grid grid-cols-3 gap-2">
                  {todo.images?.map((img) => (
                    <SignedImage
                      key={img.id}
                      img={img}
                      readOnly={readOnly}
                      onDelete={onDeleteImage}
                      onClick={(src, alt) => setPreviewImage({ src, alt })}
                    />
                  ))}
                  {pendingPreviews.map((p) => (
                    <div key={p.id} className="relative rounded-lg overflow-hidden border aspect-square cursor-pointer" onClick={() => setPreviewImage({ src: p.blobUrl, alt: p.fileName })}>
                      <img src={p.blobUrl} alt={p.fileName} className="h-full w-full object-cover" />
                      <div className="absolute inset-0 bg-background/40 flex items-center justify-center">
                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {!readOnly && (
                <>
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
                  <Button variant="outline" size="sm" className="gap-2" onClick={() => fileRef.current?.click()} disabled={isUploading}>
                    {isUploading ? (
                      <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("detail.uploading") || "Uploading..."}</>
                    ) : (
                      <><Upload className="h-3.5 w-3.5" /> {t("detail.uploadImage")}</>
                    )}
                  </Button>
                </>
              )}
            </div>

            {/* URLs */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t("detail.links")}</label>
              <div className="space-y-1.5">
                {todo.urls?.map((url) => (
                  <div key={url} className="flex items-center gap-2 rounded-md bg-muted px-3 py-1.5 text-sm">
                    <Link2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <a href={url} target="_blank" rel="noopener noreferrer" className="truncate text-primary hover:underline flex-1">
                      {url}
                    </a>
                    <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
                    {!readOnly && (
                      <button onClick={() => removeUrl(url)} className="hover:text-destructive">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {!readOnly && (
                <div className="flex gap-2">
                  <Input
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addUrl())}
                    placeholder="https://..."
                    className="h-8 text-sm"
                  />
                  <Button size="sm" variant="outline" onClick={addUrl} disabled={!urlInput.trim()}>
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>

            {/* Recurrence */}
            <RecurrenceSection todo={todo} onUpdate={onUpdate} readOnly={readOnly} t={t} />

            {/* Move to */}
            {!readOnly && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t("detail.moveTo")}</label>
                <div className="flex flex-col gap-1.5">
                  {(["today", "this_week", "next_week", "others"] as TodoCategory[])
                    .filter((cat) => cat !== todo.category)
                    .map((cat) => {
                      const c = CATEGORY_CONFIG[cat];
                      return (
                        <button
                          key={cat}
                          onClick={() => onUpdate(todo.id, { category: cat, created_at: new Date().toISOString() })}
                          className={cn(
                            "w-full text-left px-3 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-colors border bg-transparent hover:bg-accent/50",
                            c.colorClass
                          )}
                        >
                          <span>{c.emoji}</span>
                          <span>{t(CATEGORY_LABEL_KEYS[cat])}</span>
                        </button>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Image preview dialog */}
      <Dialog open={!!previewImage} onOpenChange={() => setPreviewImage(null)}>
        <DialogContent className="max-w-3xl p-2 bg-background/95">
          {previewImage && (
            <img src={previewImage.src} alt={previewImage.alt} className="w-full h-auto max-h-[80vh] object-contain rounded" />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
