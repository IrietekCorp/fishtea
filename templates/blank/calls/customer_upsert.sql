-- $1 email, $2 visitorId, $3 name
WITH c AS (
  INSERT INTO business.customer (id, email, name, created_at)
  VALUES ('cus_' || substr(md5(lower($1::text)), 1, 12), lower($1::text), $3::text, now())
  ON CONFLICT (email) DO UPDATE SET name = coalesce(excluded.name, business.customer.name)
  RETURNING id, email, name, created_at
),
bind AS (
  UPDATE conversation.visitor v SET customer_id = c.id, last_seen = now() FROM c WHERE v.id = $2::text
)
SELECT * FROM c;
