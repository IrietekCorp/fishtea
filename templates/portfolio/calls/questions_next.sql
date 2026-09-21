-- $1 askedIds text[], $2 topic — follow-ups of the asked questions first, then unasked questions on the topic, then the rest, in bank order
WITH asked AS (SELECT unnest(coalesce($1::text[], '{}')) AS id),
fu AS (SELECT unnest(q.follow_ups) AS id, 0 AS rank FROM business.question q WHERE q.id IN (SELECT id FROM asked))
SELECT q.id, q.topic, q.question, q.answer, q.follow_ups, q."order"
FROM business.question q
WHERE q.id NOT IN (SELECT id FROM asked)
ORDER BY (q.id IN (SELECT id FROM fu)) DESC, ($2::text IS NOT NULL AND q.topic ILIKE $2::text) DESC, q."order"
LIMIT 3;
