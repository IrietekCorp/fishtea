-- $1 email, $2 visitorId, $3 name, $4 organization, $5 purpose
WITH r AS (
  INSERT INTO business.requester (id, email, name, organization, purpose, created_at)
  VALUES ('rq_' || substr(md5(lower($1::text)), 1, 12), lower($1::text), $3::text, $4::text, coalesce($5::text, 'other'), now())
  ON CONFLICT (email) DO UPDATE SET name = coalesce(excluded.name, business.requester.name), organization = coalesce(excluded.organization, business.requester.organization), purpose = CASE WHEN excluded.purpose <> 'other' THEN excluded.purpose ELSE business.requester.purpose END
  RETURNING id, email, name, organization, purpose, created_at
),
bind AS (UPDATE conversation.visitor v SET customer_id = r.id, last_seen = now() FROM r WHERE v.id = $2::text)
SELECT * FROM r;
