import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
export const money = (v: unknown, currency = "USD") => typeof v === "number" || (typeof v === "string" && v !== "" && !isNaN(Number(v))) ? new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(v)) : String(v ?? "");
