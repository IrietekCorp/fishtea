import type { ComponentType } from "react";
import type { Pour, Response } from "@fishtea/ui/lib/client";
import type { Conversation } from "./useConversation";

/**
 * A view of one shape, contributed by an application's ui plugin (`views` in its manifest). The shell
 * hands it the pour, the whole response and the conversation — which is how a view speaks: `c.go`,
 * `c.contact`, `c.submit`. An answer's view also gets `answer`. A view that lays out its own threads says
 * so with `ownThreads`, and the shell does not repeat them.
 */
export interface ViewProps<A = any> { pour: Pour; res: Response; c: Conversation; answer: A }
export type View = ComponentType<ViewProps> & { ownThreads?: boolean };

/** The names views were first written against, kept so they read the same. */
export type VesselProps<A = any> = ViewProps<A>;
export type ActionViewProps = ViewProps;
