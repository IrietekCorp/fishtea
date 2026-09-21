-- $1 text, $2 category, $3 tags text[], $4 brand, $5 maxPrice, $6 limit
WITH q AS (
  SELECT nullif(trim($1::text), '') AS text, nullif(trim($2::text), '') AS category, coalesce($3::text[], '{}') AS tags,
         nullif(trim($4::text), '') AS brand, $5::numeric AS max_price, coalesce($6::int, 12) AS lim
)
SELECT p.id, p.vendor_id, p.source_id, p.name, p.description, p.brand, p.category, p.tags, p.attributes, p.price, p.currency, p.compare_at_price,
       p.stock, p.image_url, p.affiliate_url, p.fulfilment, p.status, p.updated_at,
       ( (SELECT count(*) FROM unnest(p.tags) t WHERE t = ANY(q.tags)) * 3
       + CASE WHEN q.text IS NOT NULL AND p.fts @@ plainto_tsquery('english', q.text) THEN 2 + ts_rank(p.fts, plainto_tsquery('english', q.text)) ELSE 0 END
       + CASE WHEN q.text IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(p.tags) t WHERE t ILIKE '%' || q.text || '%') THEN 3 ELSE 0 END
       + CASE WHEN q.text IS NOT NULL AND p.category ILIKE '%' || q.text || '%' THEN 2 ELSE 0 END
       + CASE WHEN p.status = 'featured' THEN 0.5 ELSE 0 END ) AS score
FROM business.product p, q
WHERE p.status IN ('active', 'featured')
  AND (p.stock > 0 OR p.affiliate_url IS NOT NULL)
  AND (q.category IS NULL OR p.category ILIKE q.category)
  AND (q.brand IS NULL OR p.brand ILIKE q.brand)
  AND (q.max_price IS NULL OR p.price <= q.max_price)
  AND ( (cardinality(q.tags) = 0 AND q.text IS NULL)
     OR p.tags && q.tags
     OR (q.text IS NOT NULL AND (p.fts @@ plainto_tsquery('english', q.text)
                                 OR EXISTS (SELECT 1 FROM unnest(p.tags) t WHERE t ILIKE '%' || q.text || '%')
                                 OR p.category ILIKE '%' || q.text || '%' OR p.name ILIKE '%' || q.text || '%')) )
ORDER BY score DESC, p.price ASC
LIMIT (SELECT lim FROM q);
