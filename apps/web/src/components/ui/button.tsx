import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";

/** Одна система кнопок на всё приложение — классы `.btn` из library-warm.
 *  Раньше `<Button>` рисовал себя своими Tailwind-классами, рядом жили
 *  `.btn` и `.lw-btn`, и три кнопки «Сохранить» выглядели по-разному. */
const VARIANT = {
  default: "btn-primary",
  secondary: "btn-secondary",
  outline: "btn-secondary",
  ghost: "btn-ghost",
  destructive: "btn-destructive",
} as const;

const SIZE = {
  default: "",
  sm: "btn-sm",
  lg: "btn-lg",
  icon: "btn-icon",
} as const;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANT | null;
  size?: keyof typeof SIZE | null;
  asChild?: boolean;
}

export function buttonClass(variant: ButtonProps["variant"] = "default", size: ButtonProps["size"] = "default") {
  return cn("btn", VARIANT[variant ?? "default"], SIZE[size ?? "default"]);
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonClass(variant, size), className)} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";
