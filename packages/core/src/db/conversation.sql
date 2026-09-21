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
  kind         text CHECK (kind IN ('ask','form','confirm-write','answer','notification')),
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
