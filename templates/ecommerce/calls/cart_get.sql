-- $1 visitorId
SELECT id, visitor_id, lines, subtotal, updated_at FROM business.cart WHERE visitor_id = $1::text;
