import * as React from "react";
import { cn } from "../../lib/utils";
export const Table = ({ className, ...p }: React.HTMLAttributes<HTMLTableElement>) => <div className="relative w-full overflow-auto rounded-lg border border-border"><table className={cn("w-full caption-bottom text-sm", className)} {...p} /></div>;
export const TableHeader = (p: React.HTMLAttributes<HTMLTableSectionElement>) => <thead className="[&_tr]:border-b [&_tr]:border-border bg-muted/50" {...p} />;
export const TableBody = (p: React.HTMLAttributes<HTMLTableSectionElement>) => <tbody className="[&_tr:last-child]:border-0" {...p} />;
export const TableRow = ({ className, ...p }: React.HTMLAttributes<HTMLTableRowElement>) => <tr className={cn("border-b border-border transition-colors hover:bg-muted/40", className)} {...p} />;
export const TableHead = ({ className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) => <th scope="col" className={cn("h-9 px-3 text-left align-middle font-medium text-muted-foreground", className)} {...p} />;
export const TableCell = ({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) => <td className={cn("px-3 py-2 align-middle", className)} {...p} />;
