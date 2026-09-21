-- $1 visitorId, $2 email, $3 lines, $4 shipTo, $5 subtotal, $6 shipping, $7 tax, $8 total
-- Runs inside a transaction (calls.order.place.transaction = true): decrement stock, empty the cart, write the order.
WITH ins AS (
  INSERT INTO business."order" (id, visitor_id, email, lines, subtotal, shipping, tax, total, ship_to, status, events, placed_at)
  SELECT 'ord_' || to_char(now(), 'YYYYMMDD') || '_' || substr(md5(random()::text), 1, 6),
         $1::text, $2::text, $3::jsonb, $5::numeric, $6::numeric, $7::numeric, $8::numeric, $4::jsonb, 'placed',
         jsonb_build_array(jsonb_build_object('at', now(), 'status', 'placed', 'note', 'Order received')), now()
  WHERE jsonb_array_length($3::jsonb) > 0
  RETURNING *
),
stock AS (
  UPDATE business.product p SET stock = greatest(0, p.stock - (l->>'qty')::int)
  FROM ins, jsonb_array_elements(ins.lines) l WHERE p.id = l->>'productId'
),
clear AS (
  DELETE FROM business.cart WHERE visitor_id = $1::text AND EXISTS (SELECT 1 FROM ins)
)
SELECT id, visitor_id, email, lines, subtotal, shipping, tax, total, ship_to, status, events, placed_at FROM ins;
