-- $1 vendorId (unused when items carry their own vendorId), $2 items jsonb: [{vendorId, sourceId, name, description, brand, category, tags[], attributes, price, currency, compareAtPrice, stock, imageUrl, affiliateUrl, fulfilment}]
WITH items AS (
  SELECT coalesce(i->>'vendorId', $1::text) AS vendor_id, i->>'sourceId' AS source_id, i->>'name' AS name, coalesce(i->>'description', '') AS description,
         i->>'brand' AS brand, coalesce(i->>'category', 'uncategorised') AS category,
         coalesce((SELECT array_agg(t) FROM jsonb_array_elements_text(coalesce(i->'tags', '[]'::jsonb)) t), '{}') AS tags,
         i->'attributes' AS attributes, (i->>'price')::numeric AS price, coalesce(i->>'currency', 'USD') AS currency, (i->>'compareAtPrice')::numeric AS compare_at_price,
         coalesce((i->>'stock')::int, 0) AS stock, i->>'imageUrl' AS image_url, i->>'affiliateUrl' AS affiliate_url,
         coalesce(i->>'fulfilment', CASE WHEN i->>'affiliateUrl' IS NOT NULL THEN 'affiliate' ELSE 'local' END) AS fulfilment
  FROM jsonb_array_elements($2::jsonb) i
  WHERE i->>'sourceId' IS NOT NULL AND i->>'name' IS NOT NULL AND i->>'price' IS NOT NULL
),
up AS (
  INSERT INTO business.product (id, vendor_id, source_id, name, description, brand, category, tags, attributes, price, currency, compare_at_price, stock, image_url, affiliate_url, fulfilment, status, updated_at)
  SELECT 'p_' || substr(md5(vendor_id || ':' || source_id), 1, 12), vendor_id, source_id, name, description, brand, category, tags, attributes, price, currency, compare_at_price, stock, image_url, affiliate_url, fulfilment, 'active', now()
  FROM items
  ON CONFLICT (id) DO UPDATE SET name = excluded.name, description = excluded.description, brand = excluded.brand, category = excluded.category, tags = excluded.tags,
    attributes = excluded.attributes, price = excluded.price, currency = excluded.currency, compare_at_price = excluded.compare_at_price, stock = excluded.stock,
    image_url = excluded.image_url, affiliate_url = excluded.affiliate_url, fulfilment = excluded.fulfilment, updated_at = now()
  RETURNING id
)
SELECT count(*)::int AS count FROM up;
