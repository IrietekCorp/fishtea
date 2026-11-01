# Plugins

Everything outside the conversation itself is a plugin: payments, auth, a design system, a frontier model,
where a notification goes. The conversational core — shapes, personas, the planner, the vessels, the
confirm-write rule — is the framework and stays the framework.

## Seven seams, one mechanism

| kind | contributes | examples |
|---|---|---|
| `integration` | calls, entities, shapes | Stripe, a frontier model, a shipping quote |
| `ui` | design tokens, optionally vessels and per-shape views | a design system for shops |
| `shell` | the whole front end, in place of the container | a site navigated by sections |
| `auth` | how a visitor becomes known | OAuth, magic links, roles |
| `classifier` | an alternative to the needle pool | a fine-tuned model, a hosted one |
| `channel` | notification delivery | email, SMS, Slack |
| `archetype` | a template `fishtea new` starts from | your own house archetype |

They are all the same shape, because archetypes were already de-facto plugins — a spec fragment plus
`calls/`, `seed/` and an interview — long before anything was called one.

## Two rules

### The spec stays yours

Adding a plugin writes **one line** naming it:

```json
"plugins": {
  "version": "2026.09.22-1",
  "payments": { "use": "stripe", "version": "^1.0.0", "kind": "integration", "config": { "currency": "usd" } }
}
```

What it contributes is merged when the spec **loads** and never written into `spec.json`. So there is no
generated code to reconcile later, no diff churn when a plugin is upgraded, and removing the line removes
everything it brought. `App.provenance` tags each contribution with its origin (`"calls.ai.ask" →
"anthropic"`), so it is always visible where something came from.

A contributed call is validated exactly as strictly as one you wrote — the same `$1..$n` SQL parameter
rules, the same file-existence checks, no exemption. Its `impl` paths are rewritten absolute at merge
time, so neither the loader nor the executor needs to know plugins exist.

### The application always wins

Name something a plugin also defines and **yours stands**, with a warning. That is the override
mechanism: to replace a plugin's call, declare a call with the same name.

Two plugins claiming one name is a different matter — nobody asked for that, and silently picking one is a
bug you would find months later — so it is an error. Rename one with `--as`, or disable it.

## Using one

```bash
fishtea plugin list                          # in use, and available
fishtea plugin info boutique
fishtea plugin add boutique --set accentHue=340 --set radius=1.25rem
fishtea plugin add anthropic --as ai --set effort=medium
fishtea plugin remove ai
```

`--set` answers the plugin's own configuration questions, which use the same vocabulary as a template's
`onboard.json`. Anything you leave out takes the manifest's default.

A plugin that cannot be resolved fails at `add` time, not on the next `serve`.

## Writing one

```bash
fishtea plugin create loyalty --kind integration
```

That scaffolds `plugins/loyalty/` in your application, with a manifest and a working call:

```json
{
  "name": "loyalty",
  "version": "0.1.0",
  "kind": "integration",
  "fishtea": "^1.8.0",
  "config": [{ "id": "greeting", "ask": "What should it say?", "type": "string", "default": "hello" }],
  "provides": {
    "calls": {
      "loyalty.ping": {
        "kind": "compute",
        "in": { "echo": "string?", "greeting": "string={{config.greeting}}" },
        "out": { "said": "string" },
        "impl": { "module": "ping.ts" }
      }
    }
  }
}
```

`{{config.x}}` is substituted when the spec loads, so a configuration answer arrives as an ordinary input
default — no new mechanism, and the classifier sees the same tool description it would for any call.

A plugin may contribute `entities`, `calls`, `shapes`, `rules`, `personas`, `notifications` and
`operator`. It may **not** contribute `business` or `envelope`: who you are and how you greet people are
yours alone.

Declare secrets so they can be checked rather than discovered at runtime:

```json
"env": ["STRIPE_SECRET_KEY"]
```

`fishtea plugin list` and `fishtea doctor` report any that are unset.

## Where plugins are found

Four places, nearest first:

```
./anything or /anything      an explicit path, relative to the application
<app>/plugins/<name>         yours, local to this application   ← where a new one starts
<app>/node_modules/<name>    installed with bun add
<framework>/plugins/<name>   shipped with fishtea               ← where a promoted one lands
```

That order is the social model: what you are working on right now beats what you installed, which beats
what shipped. A local plugin shadows a builtin of the same name, so you can try a change to a core plugin
without touching the framework.

## Promoting one

```bash
fishtea plugin promote loyalty
```

It moves out of your application's `plugins/` and into the framework's, where every application resolves
it by name. A plugin is "local" or "core" only by *where it sits*, so promoting is a move rather than a
rewrite — nothing about the plugin changes, and the application that had it keeps working untouched.

It is a move, not a copy, on purpose: leaving both would mean the local one always shadows the promoted
one, and the next person to change the core copy would wonder why nothing happened. `--copy` overrides
that when you really want both.

## Design systems

A `ui` plugin is a stylesheet of design tokens:

```json
{ "name": "boutique", "kind": "ui", "tokens": "tokens.css",
  "config": [{ "id": "accentHue", "ask": "Accent hue (0-360)", "type": "int", "default": 25 }] }
```

Every value it sets is a token `packages/ui/src/index.css` already defines, so a design system replaces no
component and rewrites no vessel — the base accessibility, contrast and focus behaviour are inherited
rather than re-earned.

Each config question needs a matching custom property: config id `accentHue` is the property
`--<plugin>-accent-hue`. Derive everything else from those, and a palette stays coherent when someone
picks a hue at 3am:

```css
:root {
  --boutique-accent-hue: 25;

  --accent: oklch(0.68 0.17 var(--boutique-accent-hue));
  --ring: var(--accent);
}
```

```bash
fishtea ui-assets    # regenerate the browser bundle's stylesheet
```

A knob that matches no declaration is **reported**, not ignored — an answered question that changes
nothing is otherwise invisible and maddening.

## Shells and views

The container — one input, the understood line, the vessel, the verify strip — is the framework's answer
to "show me the conversation". Some applications are a *site*: a menu of sections, pages you can link
to, a contact form that opens over whatever you were reading. That is a shell.

```json
{ "name": "sections", "kind": "shell", "module": "Shell.tsx" }
```

A shell exports `Shell`, and is handed the application's **views**: a `ui` plugin maps shape names to
files that export `View` — the application's own page for that shape.

```json
{ "name": "piscopour", "kind": "ui", "tokens": "tokens.css",
  "views": { "home": "views/home.view.tsx", "getInTouch": "views/getInTouch.view.tsx" } }
```

A view's words that belong to one site rather than to the design — a heading, a placeholder, a name —
are config questions marked `"for": "views"`: each application answers them in its spec (so they appear
in /admin → Settings), and the view reads them from `@app/spec.json`. They are not stylesheet knobs, so
`ui-assets` does not look for a custom property for them.

A shape with no view is drawn from the layout its answer carries (`pour.present` — see
[generative UI](generative-ui.html)), so most shapes need none. `fishtea ui-assets` writes the registry
into the application's `.fishtea/ui/`, never into the framework install; `--typecheck` checks the
application's views and shells with the framework's TypeScript. Inside them, `@fishtea/ui/*` is the UI
package (its client, the layout renderer, the vessels), `@fishtea/plugins/*` the builtin plugins and
`@app/*` the application — `@app/spec.json` is how a view reads its business's own rules. An
application's `public/` is served as is, and the page's title and description come from
`rules.site.copy`.

**`sections`** ships as the builtin shell. It navigates by `rules.site` — sections in a header, a
command bar, "up" from a child to its section, actions that open over a page — and makes browser
history the conversation: Back and Forward rewind the trail rather than asking again. What it used to
show on `/debug` — visits, turns, layouts — is in `/admin`, behind a sign-in; an old `/debug` link goes
there.

A composite's parts are streamed: the lead is drawn with the response, and each part (a strip of fresh
results under the main answer, say) lands over `/events` and is folded in where it belongs. A part that
only makes sense beside its lead says `"classify": false`, so the classifier is never offered it and
cannot pick it over the lead.

Three more things in `rules.site` are for a business whose look is its own:

- **`brand`** — its marks. `logo` (an image in `public/`, at `height` in the header and `footerHeight` in
  the footer) replaces the name set in type; `icons` are the favicon and touch icons written into
  `<head>`; `themeColor`, and `image` + `url` for what a shared link shows. Every path is in `public/` or
  an https URL, and the spec refuses anything else.
- **`menu`** — how the Ask anything menu is worn. `layout: "card"` floats it (the default); `"flush"`
  makes it the full-width sub-header under the header, with no border, corners or shadow — the input
  across the width with send at its right, the trail and suggestions on the line beneath.
  `suggestions: "ask"` sends a chip at once instead of filling the input with it.
- A `ui` plugin's **`chrome`** — its own `header` and/or `footer`, each a file exporting `View`. The
  shell keeps navigation (which sections, which is active, what a click does, history) and hands it over
  as `HeaderProps` / `FooterProps` (`@fishtea/plugins/sections/types`); the brand only decides how it
  looks. A header that is not 4rem tall says so with `--shell-header-h`, which is where the menu band
  sticks.

```json
{ "name": "chicdujour", "kind": "ui", "tokens": "tokens.css",
  "views": { "home": "views/home.view.tsx" },
  "chrome": { "header": "views/header.view.tsx", "footer": "views/footer.view.tsx" } }
```

## What ships

- **`boutique`** — a design system for shops: warm paper, one decisive accent, a distinct colour reserved
  for writes.
- **`sections`** — a shell for a site: sections from `rules.site`, views from the application, every
  other shape from its layout.
- **`anthropic`** — put a question to a frontier Claude model. Explicitly **not** a classifier: routing
  stays with the on-device needle pool under its millisecond budget, and past that budget the pour is
  still `ask`, never a slower brain. This is for composing an answer that needs more capability than a
  small on-device model has — summarising a long policy, drafting a reply, reading a pasted document.
  Set `ANTHROPIC_API_KEY`.

## Which connectors belong here

A connector to a **specific vendor** — eBay, Amazon, a particular wholesaler — is built in the product
that needs it, where there are credentials and live traffic, and comes back here as a plugin if it is
worth sharing. A connector to a **general service** every business needs — a frontier model, an email
relay, analytics, payments — belongs here, because every archetype wants it and because it can be tested
here.

The line is not how hard the integration is. It is who can honestly test it. See
[Connectors](connectors.html) for the argument and for what this repository still gets wrong.
