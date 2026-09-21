-- $1 text, $2 tags text[], $3 limit
SELECT i.id, i.name, i.description, i.tags, i.created_at FROM business.item i
WHERE ($2::text[] IS NULL OR cardinality($2::text[]) = 0 OR i.tags && $2::text[])
  AND ($1::text IS NULL OR i.fts @@ plainto_tsquery('english', $1::text) OR i.name ILIKE '%' || $1::text || '%')
ORDER BY i.created_at DESC LIMIT coalesce($3::int, 12);
