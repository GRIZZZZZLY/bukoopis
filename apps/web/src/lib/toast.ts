import { toast as sonnerToast } from "sonner";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  description?: string;
  action?: ToastAction;
  duration?: number;
}

export const toast = {
  success: (msg: string, opts?: ToastOptions) => sonnerToast.success(msg, opts),
  error: (msg: string, opts?: ToastOptions) => sonnerToast.error(msg, opts),
  info: (msg: string, opts?: ToastOptions) => sonnerToast.info(msg, opts),
  warning: (msg: string, opts?: ToastOptions) => sonnerToast.warning(msg, opts),
};
