-- $1 text, $2 category, $3 tags text[], $4 brand, $5 maxPrice, $6 limit
--
-- Forgiving on purpose. A small classifier guesses: it drops a whole phrase into `text`, or offers a
-- `category` or `tag` the catalog does not have ("linen" is a tag here, not a category). So text is matched
-- word by word, and category, brand and tag are hard filters only when the catalog actually contains that
-- value — otherwise the guess becomes one more search word. Price is always a hard filter: a budget is a promise.
WITH q AS (
  SELECT nullif(trim($1::text), '') AS text, nullif(trim($2::text), '') AS category, coalesce($3::text[], '{}') AS tags,
         nullif(trim($4::text), '') AS brand, $5::numeric AS max_price, coalesce($6::int, 12) AS lim
),
known AS (
  SELECT (SELECT count(*) > 0 FROM business.product x, q WHERE x.category ILIKE q.category) AS category,
         (SELECT count(*) > 0 FROM business.product x, q WHERE x.brand ILIKE q.brand) AS brand,
         (SELECT coalesce(array_agg(t), '{}') FROM q, unnest(q.tags) t WHERE EXISTS (SELECT 1 FROM business.product x WHERE t = ANY(x.tags))) AS tags,
         (SELECT coalesce(string_agg(t, ' '), '') FROM q, unnest(q.tags) t WHERE NOT EXISTS (SELECT 1 FROM business.product x WHERE t = ANY(x.tags))) AS loose_tags
),
words AS (
  SELECT coalesce(array_agg(DISTINCT w), '{}') AS ws
  FROM q, known, regexp_split_to_table(
         lower(concat_ws(' ', q.text, known.loose_tags, CASE WHEN NOT known.category THEN q.category END, CASE WHEN NOT known.brand THEN q.brand END)),
         '[^a-z0-9''-]+') AS w
  WHERE length(w) > 2 AND w NOT IN ('the','and','for','with','under','over','from','that','this','something','some','any','you','your','have','has','are','out','into','about','looking','show','find','need','want','like','give')
)
SELECT p.id, p.vendor_id, p.source_id, p.name, p.description, p.brand, p.category, p.tags, p.attributes, p.price, p.currency, p.compare_at_price,
       p.stock, p.image_url, p.affiliate_url, p.fulfilment, p.status, p.updated_at,
       ( (SELECT count(*) FROM unnest(p.tags) t WHERE t = ANY(known.tags)) * 4
       + (SELECT count(*) FROM unnest(words.ws) w WHERE EXISTS (SELECT 1 FROM unnest(p.tags) t WHERE t = w)) * 3
       + (SELECT count(*) FROM unnest(words.ws) w WHERE EXISTS (SELECT 1 FROM unnest(p.tags) t WHERE t LIKE '%' || w || '%')) * 1.5
       + (SELECT count(*) FROM unnest(words.ws) w WHERE lower(p.name) LIKE '%' || w || '%') * 2
       + (SELECT count(*) FROM unnest(words.ws) w WHERE lower(p.category) LIKE '%' || w || '%') * 2
       + (SELECT count(*) FROM unnest(words.ws) w WHERE lower(p.description) LIKE '%' || w || '%') * 0.5
       + CASE WHEN p.status = 'featured' THEN 0.5 ELSE 0 END ) AS score
FROM business.product p, q, known, words
WHERE p.status IN ('active', 'featured')
  AND (p.stock > 0 OR p.affiliate_url IS NOT NULL)
  AND (q.category IS NULL OR NOT known.category OR p.category ILIKE q.category)
  AND (q.brand IS NULL OR NOT known.brand OR p.brand ILIKE q.brand)
  AND (q.max_price IS NULL OR p.price <= q.max_price)
  AND ( (cardinality(known.tags) = 0 AND cardinality(words.ws) = 0)
     OR p.tags && known.tags
     OR EXISTS (SELECT 1 FROM unnest(words.ws) w
                WHERE lower(p.name) LIKE '%' || w || '%' OR lower(p.category) LIKE '%' || w || '%'
                   OR lower(p.description) LIKE '%' || w || '%'
                   OR EXISTS (SELECT 1 FROM unnest(p.tags) t WHERE t LIKE '%' || w || '%')) )
ORDER BY score DESC, p.price ASC
LIMIT (SELECT lim FROM q);
