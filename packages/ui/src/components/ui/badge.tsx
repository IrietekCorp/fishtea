import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";
const badgeVariants = cva("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", { variants: { variant: { default: "border-transparent bg-primary text-primary-foreground", secondary: "border-transparent bg-muted text-foreground", outline: "border-border text-foreground", accent: "border-transparent bg-accent text-accent-foreground", write: "border-transparent bg-write text-white" } }, defaultVariants: { variant: "secondary" } });
export const Badge = ({ className, variant, ...p }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) => <span className={cn(badgeVariants({ variant }), className)} {...p} />;
