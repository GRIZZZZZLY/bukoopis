import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "./button";

export interface AlertDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  onClose: () => void;
  actions: ReactNode;
  closeOnOverlayClick?: boolean;
  children?: ReactNode;
  width?: "default" | "wide";
}

export function AlertDialog({
  open,
  title,
  description,
  onClose,
  actions,
  closeOnOverlayClick = true,
  children,
  width = "default",
}: AlertDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const lastActiveRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    lastActiveRef.current = document.activeElement as HTMLElement | null;
    const node = dialogRef.current;
    const focusTarget =
      node?.querySelector<HTMLElement>("[data-autofocus]") ??
      node?.querySelector<HTMLElement>("button, [tabindex]:not([tabindex='-1'])");
    focusTarget?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      lastActiveRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="presentation"
    >
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[1px] animate-in fade-in"
        onClick={() => {
          if (closeOnOverlayClick) onClose();
        }}
      />
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="alert-dialog-title"
        aria-describedby={description ? "alert-dialog-desc" : undefined}
        className={
          "relative z-10 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-6 shadow-lg " +
          (width === "wide" ? "max-w-3xl" : "max-w-md")
        }
      >
        <h2
          id="alert-dialog-title"
          className="text-lg font-semibold text-[var(--color-foreground)]"
        >
          {title}
        </h2>
        {description !== undefined && (
          <div
            id="alert-dialog-desc"
            className="mt-2 text-sm text-[var(--color-muted-foreground)]"
          >
            {description}
          </div>
        )}
        {children}
        <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
          {actions}
        </div>
      </div>
    </div>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: "default" | "destructive";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = "Подтвердить",
  cancelText = "Отмена",
  variant = "default",
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <AlertDialog
      open={open}
      title={title}
      description={description}
      onClose={onCancel}
      actions={
        <>
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={busy}
            data-autofocus
          >
            {cancelText}
          </Button>
          <Button
            variant={variant === "destructive" ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "…" : confirmText}
          </Button>
        </>
      }
    />
  );
}
