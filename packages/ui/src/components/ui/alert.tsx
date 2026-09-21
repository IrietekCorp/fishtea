import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";
const alertVariants = cva("relative w-full rounded-lg border p-4 text-sm [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg+div]:pl-7", { variants: { variant: { default: "border-border bg-card", success: "border-success/40 bg-success/10", destructive: "border-write/40 bg-write/10", info: "border-accent/40 bg-accent/10" } }, defaultVariants: { variant: "default" } });
export const Alert = ({ className, variant, ...p }: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>) => <div role="alert" className={cn(alertVariants({ variant }), className)} {...p} />;
export const AlertTitle = ({ className, ...p }: React.HTMLAttributes<HTMLHeadingElement>) => <h5 className={cn("mb-1 font-medium leading-none", className)} {...p} />;
export const AlertDescription = ({ className, ...p }: React.HTMLAttributes<HTMLParagraphElement>) => <div className={cn("text-sm [&_p]:leading-relaxed", className)} {...p} />;
