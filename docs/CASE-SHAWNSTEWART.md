# shawnstewart.me: a portfolio that answers the question you actually have

[shawnstewart.me](https://shawnstewart.me) is the portfolio of a VP of Engineering and CTO candidate.
A portfolio is normally a set of pages arranged in the order the author finds flattering, and the
visitor is a recruiter with one question the pages are not arranged around: *does this person fit the
role I am hiring for?*

Fifteen entities, twenty-two shapes, twenty-five calls, three personas, one `spec.json`. The site is the
answer to that question and twenty-one others.

## Paste the job description, get it back marked up

`fitFor` takes a job description as text. Its plan is two steps:

```json
"plan": [
  { "id": "e", "call": "evidence.all", "with": {} },
  { "id": "m", "call": "jd.match", "with": { "jd": "$role", "rows": "$e" }, "after": ["e"] }
]
```

`evidence.all` gathers every role, outcome, skill, principle, project and credential on the site.
`jd.match` is a **compute call**: it splits the description into its requirements, matches each against
every piece of evidence, and returns each requirement as `strong`, `partial` or `gap` with the rows
behind it. The vessel is `detail`, so the answer arrives as a tally and a list you can read down.

Three things about that are worth stating precisely.

**No model decides any of it.** `jd.match` is TypeScript. Scoring is shared words weighted by how rare
they are in this corpus, and two requirements are checked against arithmetic rather than words: years in
the field, derived from the first role's start date, and the size of the organisation led, read out of
the "75-person" and "38 engineers" the roles already state. A language model that graded its own
candidate against its own evidence would be worth nothing to a recruiter, which is the point.

**The synonym table is a declaration, not a prompt.** Job ads and resumes name the same thing
differently, so there is a `WIDEN` map: `offshore` brings `distributed`, `global`, `time`, `zones`,
`partner`. You can read it, diff it and argue with it. A prompt that did the same work would be none of
those things.

**Gaps are reported.** The answer has a `gap` category and uses it. A match that never admits a gap is a
brochure, and recruiters can tell.

## The frontier model is a second opinion, never the router

`fitDeep` runs after `fitFor` and asks a hosted model for a deeper read, pointed at an
OpenAI-compatible server declared in `rules.fit.deep`:

```json
"deep": { "url": "https://api.anansify.live", "model": "gemma4:4b", "maxTokens": 1400, "timeoutMs": 55000 }
```

Note what that is and is not. Every turn on the site, including the one that asked for the deep read, is
still routed by the small on-device classifier inside its hard budget. The hosted model is one optional
shape that runs afterwards, and its output is checked against the evidence rather than trusted.

This is the framework's position made concrete: a hosted key is a decision a single application makes
for a single shape. It is never something FishTea requires, and an application that drops the key loses
one answer and keeps twenty-one.

## A labelled set, and the uncomfortable thing it found

`eval/classify.jsonl` holds 131 labelled utterances across all twenty shapes and all three personas,
about a quarter of them refusals. It is the only measurement of this site's classifier that the spec
cannot derive, and it earned its place immediately.

The first full run scored **37%**: 76% on plain utterances carrying a shape's own trigger words, and
**4% on paraphrases**. The cause was not the model. `askAbout` asks "anything about Shawn", and a shape
that broad is an attractor that swallows nearly every question carrying no trigger. Twenty of twenty-six
missed questions went to it.

Two things follow, and they are the reason this is in a case study rather than buried in a commit.

First, an earlier 45-case set had scored far better, because three of its five paraphrases were
`askAbout`'s to begin with. A labelled set that is too small does not report a smaller version of the
truth. It reports a different and more flattering one.

Second, the fix is a **spec** change, narrowing what `askAbout` claims, not a model change. The
instrument pointed at the description, which is where the problem was. That is the argument for having
the instrument.

The finding is recorded in the eval file's own header, where the next person to run it will see it
before they draw a conclusion.

## Evidence, not assertions, as the data model

The entity list is the design: `outcome`, `principle`, `credential`, `press`, `testimonial`, a
`question` bank behind `askAbout`, and `roleMatch` to keep the matches people ran. `patents` is not an
entity of its own: it reads the `credential` rows that happen to be patents, alongside the `project`
rows for what he invents now. Every claim the site makes is a row that something can cite, which is why `jd.match` can hand back
the specific evidence under each requirement instead of a score.

`reference` and `sendRole` are writes, so they pour `confirm-write` first: the visitor sees exactly what
is about to be recorded or sent before it happens.

## What to take from it

- **Build around the question the visitor came with.** A portfolio's real shape is a matching problem,
  and once you say so, the data model follows.
- **Keep judgement in rules you can read.** The scoring, the thresholds and the synonyms are all
  inspectable. A recruiter can be told how the number was reached.
- **Use the frontier model where it adds, not where it routes.** One shape, after the deterministic
  answer, checked against the evidence.
- **Write the labelled set early and make it big enough to hurt.** A small one will tell you what you
  hoped to hear.
