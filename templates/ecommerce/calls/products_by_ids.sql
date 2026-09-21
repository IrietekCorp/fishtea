-- $1 ids text[]
SELECT p.id, p.vendor_id, p.source_id, p.name, p.description, p.brand, p.category, p.tags, p.attributes, p.price, p.currency, p.compare_at_price,
       p.stock, p.image_url, p.affiliate_url, p.fulfilment, p.status, p.updated_at
FROM business.product p JOIN unnest($1::text[]) WITH ORDINALITY AS want(id, ord) ON want.id = p.id ORDER BY want.ord;
