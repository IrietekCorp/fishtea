import type { ComponentType } from "react";
import type { Pour, Response } from "@fishtea/ui/lib/client";
import type { Conversation } from "./useConversation";
import type { Profile } from "./site";

/**
 * A view of one shape, contributed by an application's ui plugin (`views` in its manifest). The shell
 * hands it the pour, the whole response and the conversation — which is how a view speaks: `c.go`,
 * `c.contact`, `c.submit`. An answer's view also gets `answer`. A view that lays out its own threads says
 * so with `ownThreads`, and the shell does not repeat them. A page's view that draws its own form and
 * confirm-write (an action's always does) says so with `forms`; otherwise the shell's generic form is used.
 */
export interface ViewProps<A = any> { pour: Pour; res: Response; c: Conversation; answer: A }
export type View = ComponentType<ViewProps> & { ownThreads?: boolean; forms?: boolean };

/** The names views were first written against, kept so they read the same. */
export type VesselProps<A = any> = ViewProps<A>;
export type ActionViewProps = ViewProps;

/**
 * The brand's own frame (a ui plugin's `chrome`). The shell keeps navigation — what is a section, which
 * one is active, how a click becomes a turn and a history entry — and hands it over ready to draw: a
 * link's `href` is real (new tabs, crawlers) and its `onClick` goes in place. A header or footer only
 * decides how that looks.
 */
export interface NavLink { shape: string; label: string; href: string; onClick: (e: React.MouseEvent) => void; active: boolean }
export interface Act { label: string; go: () => void }
export interface Brand { name: string; doc?: string; logo: { src: string; alt?: string; height?: number; footerHeight?: number } | null }
export interface HeaderProps { c: Conversation; brand: Brand; home: NavLink; sections: NavLink[]; action: Act | null }
export interface FooterProps {
  c: Conversation; brand: Brand; home: NavLink;
  sections: (NavLink & { children: Act[] })[];
  /** remember me, cookie settings: what the site offers beside its sections */
  utilities: Act[];
  cta: { title: string; lead: string; action: Act | null };
  /** the business's other profiles (`rules.site.social`), those with a URL */
  social: Profile[];
}
export type Chrome = Partial<{ header: ComponentType<HeaderProps>; footer: ComponentType<FooterProps> }>;
