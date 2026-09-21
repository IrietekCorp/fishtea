-- $1 days, $2 limit — reactions in the window, then featured
SELECT p.id, p.vendor_id, p.source_id, p.name, p.description, p.brand, p.category, p.tags, p.attributes, p.price, p.currency, p.compare_at_price,
       p.stock, p.image_url, p.affiliate_url, p.fulfilment, p.status, p.updated_at
FROM business.product p
LEFT JOIN (SELECT product_id, count(*) FILTER (WHERE kind IN ('love', 'save', 'click')) AS heat FROM business.reaction WHERE at > now() - make_interval(days => coalesce($1::int, 7)) GROUP BY product_id) r ON r.product_id = p.id
WHERE p.status IN ('active', 'featured') AND (p.stock > 0 OR p.affiliate_url IS NOT NULL)
ORDER BY coalesce(r.heat, 0) DESC, (p.status = 'featured') DESC, p.updated_at DESC
LIMIT coalesce($2::int, 8);
