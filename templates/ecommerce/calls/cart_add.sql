-- $1 visitorId, $2 productId, $3 qty
WITH prod AS (
  SELECT id, name, price FROM business.product WHERE id = $2::text AND stock > 0 AND status IN ('active', 'featured')
),
existing AS (
  SELECT lines FROM business.cart WHERE visitor_id = $1::text
),
merged AS (
  SELECT coalesce(
    (SELECT jsonb_agg(
        CASE WHEN l->>'productId' = prod.id
             THEN jsonb_set(l, '{qty}', to_jsonb((l->>'qty')::int + coalesce($3::int, 1)))
             ELSE l END)
     FROM existing, jsonb_array_elements(existing.lines) l, prod), '[]'::jsonb) AS lines
),
final AS (
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM merged, jsonb_array_elements(merged.lines) l WHERE l->>'productId' = $2::text) THEN (SELECT lines FROM merged)
    ELSE (SELECT lines FROM merged) || (SELECT jsonb_build_array(jsonb_build_object('productId', prod.id, 'name', prod.name, 'price', prod.price, 'qty', coalesce($3::int, 1))) FROM prod)
  END AS lines
),
subtotal AS (
  SELECT coalesce(sum((l->>'price')::numeric * (l->>'qty')::int), 0) AS subtotal FROM final, jsonb_array_elements(final.lines) l
),
upsert AS (
  INSERT INTO business.cart (id, visitor_id, lines, subtotal, updated_at)
  SELECT 'cart_' || $1::text, $1::text, final.lines, subtotal.subtotal, now() FROM final, subtotal
  WHERE EXISTS (SELECT 1 FROM prod)
  ON CONFLICT (visitor_id) DO UPDATE SET lines = excluded.lines, subtotal = excluded.subtotal, updated_at = now()
  RETURNING id, visitor_id, lines, subtotal, updated_at
)
SELECT * FROM upsert;
