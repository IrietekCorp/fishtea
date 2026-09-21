-- $1 visitorId, $2 productId
WITH kept AS (
  SELECT coalesce(jsonb_agg(l) FILTER (WHERE l->>'productId' <> $2::text), '[]'::jsonb) AS lines
  FROM business.cart c, jsonb_array_elements(c.lines) l WHERE c.visitor_id = $1::text
),
subtotal AS (
  SELECT coalesce(sum((l->>'price')::numeric * (l->>'qty')::int), 0) AS subtotal FROM kept, jsonb_array_elements(kept.lines) l
)
UPDATE business.cart c SET lines = kept.lines, subtotal = subtotal.subtotal, updated_at = now()
FROM kept, subtotal WHERE c.visitor_id = $1::text
RETURNING c.id, c.visitor_id, c.lines, c.subtotal, c.updated_at;
