-- Fixed conversation schema (BLUEPRINT §6). Never changes shape from the spec.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS conversation;
CREATE SCHEMA IF NOT EXISTS fishtea;

CREATE TABLE IF NOT EXISTS fishtea.migration (
  section     text PRIMARY KEY,
  hash        text NOT NULL,
  version     text NOT NULL,
  applied_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversation.visitor (
  id           text PRIMARY KEY,
  customer_id  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversation.trail (
  id           text PRIMARY KEY,
  visitor_id   text NOT NULL REFERENCES conversation.visitor(id),
  head_turn_id text,
  envelope     jsonb NOT NULL,
  opened_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trail_visitor_idx ON conversation.trail (visitor_id, opened_at DESC);

CREATE TABLE IF NOT EXISTS conversation.turn (
  id           text PRIMARY KEY,
  trail_id     text NOT NULL REFERENCES conversation.trail(id),
  parent_id    text REFERENCES conversation.turn(id),
  seq          integer NOT NULL,
  author       text NOT NULL CHECK (author IN ('visitor','system','operator')),
  at           timestamptz NOT NULL DEFAULT now(),
  shape        text,
  kind         text CHECK (kind IN ('ask','form','confirm-write','answer','notification','composite')),
  confidence   real,
  answered     boolean NOT NULL,
  latency_ms   integer,
  utterance    jsonb NOT NULL,
  pour         jsonb NOT NULL,
  provenance   jsonb NOT NULL,
  embedding    halfvec(3072)
);
CREATE INDEX IF NOT EXISTS turn_trail_seq_idx ON conversation.turn (trail_id, seq);
CREATE INDEX IF NOT EXISTS turn_shape_idx ON conversation.turn (shape) WHERE answered;
CREATE INDEX IF NOT EXISTS turn_unmet_idx ON conversation.turn (at) WHERE NOT answered;

-- Notifications addressed to a visitor that have not been rendered into a trail yet.
CREATE TABLE IF NOT EXISTS conversation.pending_notification (
  id           text PRIMARY KEY,
  visitor_id   text NOT NULL REFERENCES conversation.visitor(id),
  author       text NOT NULL CHECK (author IN ('system','operator')),
  name         text,
  text         text NOT NULL,
  next         jsonb NOT NULL DEFAULT '[]',
  at           timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
CREATE INDEX IF NOT EXISTS pending_notification_visitor_idx ON conversation.pending_notification (visitor_id) WHERE delivered_at IS NULL;

-- The vendor channel: one query, because both halves live together.
CREATE OR REPLACE VIEW conversation.unmet AS
  SELECT t.at, t.utterance->>'text' AS asked, tr.envelope->>'utm_campaign' AS campaign, v.customer_id, t.trail_id, v.id AS visitor_id
  FROM conversation.turn t
  JOIN conversation.trail tr ON tr.id = t.trail_id
  JOIN conversation.visitor v ON v.id = tr.visitor_id
  WHERE NOT t.answered AND t.author = 'visitor';

-- Echoes: what a visitor did with an answer that leaves the conversation (an outbound link, today). A
-- reverb of the turn that offered it, never a turn of its own: it does not move the head and is not
-- something to rewind to. `shared` is an echo from someone other than the turn's own visitor (a link
-- passed on). `destination` is what the answer published; `location` is where the visitor was sent
-- (the handler's rewrite, or the same). docs/ECHOES.md.
CREATE TABLE IF NOT EXISTS conversation.echo (
  id           text PRIMARY KEY,
  kind         text NOT NULL,
  visitor_id   text NOT NULL REFERENCES conversation.visitor(id),
  trail_id     text NOT NULL REFERENCES conversation.trail(id),
  turn_id      text NOT NULL REFERENCES conversation.turn(id),
  shape        text,
  via          text NOT NULL CHECK (via IN ('redirect','beacon')),
  shared       boolean NOT NULL DEFAULT false,
  persona      text,
  destination  text NOT NULL,
  location     text,
  data         jsonb NOT NULL DEFAULT '{}',
  note         text,
  handler_ms   integer,
  at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS echo_turn_idx ON conversation.echo (turn_id);
CREATE INDEX IF NOT EXISTS echo_visitor_idx ON conversation.echo (visitor_id, at DESC);
CREATE INDEX IF NOT EXISTS echo_kind_at_idx ON conversation.echo (kind, at DESC);

-- A pour kind added after a database was created does not reach it: the table above is CREATE TABLE IF
-- NOT EXISTS, so an existing turn table keeps whatever CHECK it was born with and every composite pour
-- would fail to append. Restating the constraint is idempotent and cheap, and it is the only part of
-- this file that has to run against a database that already exists.
ALTER TABLE conversation.turn DROP CONSTRAINT IF EXISTS turn_kind_check;
ALTER TABLE conversation.turn ADD CONSTRAINT turn_kind_check
  CHECK (kind IN ('ask','form','confirm-write','answer','notification','composite'));

-- Operators: the people who run this application, signing in to /admin. A password is stored only as an
-- argon2id hash; a session only as the sha256 of its token, so a database read hands out no way in.
CREATE TABLE IF NOT EXISTS fishtea.operator (
  id            text PRIMARY KEY,
  username      text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  must_change   boolean NOT NULL DEFAULT false,
  failed        integer NOT NULL DEFAULT 0,
  locked_until  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  changed_at    timestamptz
);
CREATE TABLE IF NOT EXISTS fishtea.operator_session (
  token_hash   text PRIMARY KEY,
  operator_id  text NOT NULL REFERENCES fishtea.operator(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS operator_session_operator_idx ON fishtea.operator_session (operator_id);
