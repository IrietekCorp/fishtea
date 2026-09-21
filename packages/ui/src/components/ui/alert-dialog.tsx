import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import { cn } from "../../lib/utils";
import { Button } from "./button";
export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;
export function AlertDialogContent({ className, children, ...p }: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <AlertDialogPrimitive.Content className={cn("fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-6 shadow-lg", className)} {...p}>{children}</AlertDialogPrimitive.Content>
    </AlertDialogPrimitive.Portal>
  );
}
export const AlertDialogTitle = ({ className, ...p }: React.ComponentProps<typeof AlertDialogPrimitive.Title>) => <AlertDialogPrimitive.Title className={cn("text-lg font-semibold", className)} {...p} />;
export const AlertDialogDescription = ({ className, ...p }: React.ComponentProps<typeof AlertDialogPrimitive.Description>) => <AlertDialogPrimitive.Description className={cn("text-sm text-muted-foreground", className)} {...p} />;
export const AlertDialogAction = ({ className, ...p }: React.ComponentProps<typeof AlertDialogPrimitive.Action>) => <AlertDialogPrimitive.Action asChild><Button variant="write" className={className} {...(p as any)} /></AlertDialogPrimitive.Action>;
export const AlertDialogCancel = ({ className, ...p }: React.ComponentProps<typeof AlertDialogPrimitive.Cancel>) => <AlertDialogPrimitive.Cancel asChild><Button variant="outline" className={className} {...(p as any)} /></AlertDialogPrimitive.Cancel>;
