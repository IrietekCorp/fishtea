-- $1 email, $2 visitorId, $3 name, $4 organization, $5 intent, $6 message
WITH c AS (
  INSERT INTO business.contact (id, email, name, organization, intent, message, created_at)
  VALUES ('ct_' || substr(md5(lower($1::text)), 1, 12), lower($1::text), $3::text, $4::text, coalesce($5::text, 'other'), $6::text, now())
  ON CONFLICT (email) DO UPDATE SET name = coalesce(excluded.name, business.contact.name), organization = coalesce(excluded.organization, business.contact.organization),
    intent = CASE WHEN excluded.intent <> 'other' THEN excluded.intent ELSE business.contact.intent END, message = coalesce(excluded.message, business.contact.message)
  RETURNING id, email, name, organization, intent, message, created_at
),
bind AS (UPDATE conversation.visitor v SET customer_id = c.id, last_seen = now() FROM c WHERE v.id = $2::text)
SELECT * FROM c;
