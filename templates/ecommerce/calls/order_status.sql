-- $1 orderId, $2 visitorId — scoped to the visitor; someone else's order id yields no row
SELECT row_to_json(o)::jsonb - 'events' AS "order", o.events
FROM (SELECT id, visitor_id AS "visitorId", email, lines, subtotal, shipping, tax, total, ship_to AS "shipTo", status, events, placed_at AS "placedAt"
      FROM business."order" WHERE id = $1::text AND visitor_id = $2::text) o;
