-- $1 text, $2 skill, $3 limit
SELECT p.id, p.name, p.role, p.summary, p.outcome, p.skills, p.year, p.url, p.image_url, p.featured
FROM business.project p
WHERE ($2::text IS NULL OR EXISTS (SELECT 1 FROM unnest(p.skills) s WHERE s ILIKE '%' || $2::text || '%'))
  AND ($1::text IS NULL OR p.fts @@ plainto_tsquery('english', $1::text) OR EXISTS (SELECT 1 FROM regexp_split_to_table(lower($1::text), '\s+') w WHERE length(w) > 3 AND (lower(p.name) LIKE '%' || w || '%' OR lower(p.summary) LIKE '%' || w || '%' OR lower(p.outcome) LIKE '%' || w || '%' OR EXISTS (SELECT 1 FROM unnest(p.skills) s WHERE lower(s) LIKE '%' || w || '%'))))
ORDER BY p.featured DESC, p.year DESC LIMIT coalesce($3::int, 6);
