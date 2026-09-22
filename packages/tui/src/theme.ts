/** One palette for the console. Colour never carries meaning alone: every dot has a word next to it. */
export const theme = {
  accent: "cyan",
  dim: "gray",
  ok: "green",
  warn: "yellow",
  bad: "red",
  write: "magenta",
  text: "white",
} as const;

export const SCREENS = [
  { key: "1", id: "dashboard", label: "Dashboard" },
  { key: "2", id: "spec", label: "Spec" },
  { key: "3", id: "conversations", label: "Conversations" },
  { key: "4", id: "run", label: "Run" },
  { key: "5", id: "onboard", label: "Onboard" },
  { key: "6", id: "versions", label: "Versions" },
] as const;
export type ScreenId = (typeof SCREENS)[number]["id"];
