-- $1 productId, $2 limit — other categories sharing tags with the seed
WITH seed AS (SELECT * FROM business.product WHERE id = $1::text)
SELECT p.id, p.vendor_id, p.source_id, p.name, p.description, p.brand, p.category, p.tags, p.attributes, p.price, p.currency, p.compare_at_price,
       p.stock, p.image_url, p.affiliate_url, p.fulfilment, p.status, p.updated_at
FROM business.product p, seed
WHERE p.id <> seed.id AND p.status IN ('active', 'featured') AND (p.stock > 0 OR p.affiliate_url IS NOT NULL) AND p.tags && seed.tags
ORDER BY (p.category <> seed.category) DESC, (SELECT count(*) FROM unnest(p.tags) t WHERE t = ANY(seed.tags)) DESC, p.price
LIMIT coalesce($2::int, 6);
