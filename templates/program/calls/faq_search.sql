-- $1 text, $2 limit — full text first, then trigram-ish ILIKE on words
WITH q AS (SELECT plainto_tsquery('english', $1::text) AS tsq, lower($1::text) AS raw)
SELECT f.id, f.question, f.answer, f."order", f.is_active,
       ts_rank(f.fts, q.tsq) * 10
       + (SELECT count(*) FROM regexp_split_to_table(q.raw, '\s+') w WHERE length(w) > 3 AND (lower(f.question) LIKE '%' || w || '%' OR lower(f.answer) LIKE '%' || w || '%')) AS score
FROM business.faq f, q
WHERE f.is_active
  AND (f.fts @@ q.tsq OR EXISTS (SELECT 1 FROM regexp_split_to_table(q.raw, '\s+') w WHERE length(w) > 3 AND (lower(f.question) LIKE '%' || w || '%' OR lower(f.answer) LIKE '%' || w || '%')))
ORDER BY score DESC, f."order"
LIMIT coalesce($2::int, 5);
