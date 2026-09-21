-- $1 visitorId, $2 productId, $3 kind
INSERT INTO business.reaction (id, visitor_id, product_id, kind, at)
SELECT 'rx_' || substr(md5(random()::text), 1, 8), $1::text, p.id, $3::text, now()
FROM business.product p WHERE p.id = $2::text
RETURNING id, visitor_id, product_id, kind, at;
