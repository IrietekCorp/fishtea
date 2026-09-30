/* The base: no application has generated its own yet. `fishtea ui-assets --app <dir>` writes the real one
   into that application's .fishtea/ui/, and vite.config.ts points #generated there when it exists. */
import type { ComponentType } from "react";

export const vesselOverrides: Partial<Record<string, ComponentType<any>>> = {};
export const views: Partial<Record<string, ComponentType<any>>> = {};
export const shell: ComponentType<any> | null = null;
