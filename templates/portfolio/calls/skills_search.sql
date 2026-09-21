-- $1 text, $2 category, $3 minLevel
WITH lv AS (SELECT * FROM (VALUES ('familiar', 1), ('working', 2), ('strong', 3), ('expert', 4)) AS t(name, n))
SELECT s.id, s.name, s.level, s.years, s.category, s.evidence
FROM business.skill s
WHERE ($2::text IS NULL OR s.category ILIKE '%' || $2::text || '%')
  AND ($3::text IS NULL OR (SELECT n FROM lv WHERE name = s.level) >= coalesce((SELECT n FROM lv WHERE name = $3::text), 1))
  AND ($1::text IS NULL OR s.fts @@ plainto_tsquery('english', $1::text) OR EXISTS (SELECT 1 FROM regexp_split_to_table(lower($1::text), '\s+') w WHERE length(w) > 2 AND (lower(s.name) LIKE '%' || w || '%' OR lower(s.category) LIKE '%' || w || '%' OR lower(s.evidence) LIKE '%' || w || '%')))
ORDER BY (SELECT n FROM lv WHERE name = s.level) DESC, s.years DESC NULLS LAST, s.name;
