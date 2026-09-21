import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { cn } from "../../lib/utils";
export const Checkbox = ({ className, ...p }: React.ComponentProps<typeof CheckboxPrimitive.Root>) => (
  <CheckboxPrimitive.Root className={cn("peer h-4 w-4 shrink-0 rounded-sm border border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground", className)} {...p}>
    <CheckboxPrimitive.Indicator className="flex items-center justify-center"><Check className="h-3 w-3" /></CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
);
