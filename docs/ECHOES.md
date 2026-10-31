# Echoes

*What a visitor did with an answer, once it took them out of the conversation.*

An answer can end in a link: the shop that sells the product, the paper behind the citation, the map to
the venue. Until echoes the conversation lost the visitor at that point. It knew what it had shown and
not what they followed. Echoes close that gap without turning the framework into a link shortener.

## A reverb, not a turn

A turn is something said, which moves the trail's head and can be rewound to. Following a link is
neither. So an echo is recorded **beside** the turn whose answer offered it, in `conversation.echo`. It
names the turn, the visitor, the destination and where the visitor actually went. It never becomes a turn
of its own: the head stays where it was, a rewind does not show it, and a resume does not pour it.

That makes an echo a fact about an answer: *this answer, shown to this visitor, sent them to that place*.
It is the fact an affiliate site needs to join a sale back to the question that produced it. A
publication can use it to see which sources readers trust, and a venue to see which directions people
asked for.

## The trail is the signature

`/echo` follows a destination only when the conversation published it. The turn the link names (or, when
a page keeps an older turn on screen, a recent turn on the same trail) must contain the URL, exactly, in
its stored pour. That is the whole of the safety argument:

- **It is not an open redirect.** A URL no answer ever contained is refused (404), so `/echo?to=` cannot
  be pointed at a phishing page.
- **It needs no signing secret.** There is no token to mint, rotate or leak. The trail already says what
  was published and to whom.
- **The handler is told what was followed, not asked to trust the browser.** The innermost object that
  carried the URL in the answer (a product row, a link molecule) is passed to the handler as `record`. A
  handler reads the vendor, the price or the document id from there, never from a query parameter.

A link passed on to someone else still works, because the destination was legitimately published. It is
recorded as `shared`, under the visitor who followed it.

## Declaring an echo

Echoes are a spec section of their own, beside `notifications` (spec format 1.2):

```jsonc
"echoes": {
  "version": "2026.11.01-1",
  "outbound": {
    "doc": "A visitor followed a product to the shop that sells it",
    "handler": "echo.outbound",          // a compute call; optional
    "analytics": "outbound_click",       // the GA4 event a shell reports; default the echo's name; false for none
    "allow": ["stranger", "known", "customer"],   // optional; absent means every persona
    "via": "redirect",                   // default
    "cases": [
      { "hosts": ["*.amazon.com"], "via": "beacon", "handler": false,
        "doc": "Amazon links go direct: reported beside the link, never redirected" }
    ]
  }
}
```

**Transports.** How the browser reaches `/echo`:

| `via` | the link is | `/echo` answers |
|---|---|---|
| `redirect` | `/echo?echo=outbound&turn=…&to=…` | records, runs the handler, **302** to the destination or the handler's rewrite |
| `beacon` | the destination itself | `navigator.sendBeacon` posts the echo beside the click; records, runs the handler, **204** |

`redirect` is the default because it works without JavaScript and records every click, analytics consent
or not. `beacon` exists for destinations that must not be reached through a redirect. Some affiliate
programmes say so outright, and a handler cannot change where a beacon's visitor goes.

**Cases.** The first case whose `hosts` match the destination wins, and may change the transport, the
handler (`false` for none) and the analytics event. `*.example.com` matches the domain and every
subdomain; a bare host matches itself and its `www.`. The browser and the core use the same function to
decide this (`planEcho`, `@fishtea/spec`'s `echo.ts`, reached in the browser as `@fishtea/echo`), so the
link a page draws and the outcome the core gives it never disagree about which case applies.

**The handler** is an ordinary compute call from `calls`. It must be compute: it decides, it does not read
or write, and it runs while a visitor waits on a redirect. Its budget is its own `timeoutMs`, else
`rules.calls.timeoutMs`. It receives:

```ts
{ echo, echoId, to, via, record, turnId, shape, persona, shared }
```

and may answer `{ location?, data? }`. `location` replaces the destination: an affiliate handler adds the
network's sub-id (`clickref=<echoId>`) so a reported sale names this echo. `data` is kept with the
record. A handler that throws, overruns or answers anything but an http(s) location is a `note` on the
echo, and the visitor goes to the destination as published. **An echo never strands anyone.**

**allow.** A persona an echo does not allow is sent on as published and nothing is recorded. The link
was on their screen, so an error page would protect nothing.

## In the browser

The page's `<head>` carries the public half of the section as `window.__fishteaEchoes`: transports,
analytics names and host cases. A handler's name never reaches the browser.

- **Every external link Present draws echoes**: a molecule's `href`, a highlight, an action button, a hero's
  contact line. So does every `*Url` field in the built-in vessels. They name the turn on screen, which
  the container and the sections shell provide (`EchoTurn`). This happens only when the application
  declares an echo named `outbound`; without one they are ordinary links.
- **A plugin view** uses `echoLink(to, { turnId, echo?, sponsored?, params? })` from
  `@fishtea/ui/lib/echo`, which answers the anchor's attributes (or `EchoAnchor` to draw one).
  `sponsored: true` adds `rel="sponsored"`, which affiliate programmes and search engines ask of a paid
  link.
- **Analytics.** A click also reports the echo's event to `gtag` with `transport_type: "beacon"`, so it
  survives the page leaving, along with the link's URL and domain and any `params`. `gtag` exists only once
  the visitor accepted analytics (`consent.tsx`), so declining is honoured with no check of its own. The
  server-side record does not depend on consent: it is the site's own first-party log of what its answers
  led to, and says nothing to Google.

## For the operator

- `GET /op/echoes?since=7 days&echo=outbound&limit=200`: what left the conversation, newest first.
- `GET /op/turns/:id` carries that turn's `echoes`.
- `fishtea visitors prune` removes a pruned visitor's echoes with their trails.

## What it is not, yet

- **Not a turn input to personas.** `TrailFact` does not see echoes, so a persona cannot yet say "has
  clicked out before". That is easy to add once someone needs it.
- **Not an analytics plugin.** The seam CONNECTORS.md asks for (a `record(event)` the engine calls after
  each turn) is still open. Echo events go to `gtag` from the browser, which covers the outbound click and
  nothing else.
- **Not only links, in principle.** Copying an answer, sharing it and downloading it are echoes too. Each
  would be another entry in `echoes` with its own transport. None is built.
