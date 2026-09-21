-- $1 email, $2 visitorId, $3 parentFirstName, $4 parentLastName, $5 phone
WITH f AS (
  INSERT INTO business.family (id, email, parent_first_name, parent_last_name, phone, created_at)
  VALUES ('fam_' || substr(md5(lower($1::text)), 1, 12), lower($1::text), $3::text, $4::text, $5::text, now())
  ON CONFLICT (email) DO UPDATE SET
    parent_first_name = coalesce(excluded.parent_first_name, business.family.parent_first_name),
    parent_last_name  = coalesce(excluded.parent_last_name, business.family.parent_last_name),
    phone             = coalesce(excluded.phone, business.family.phone)
  RETURNING id, email, parent_first_name, parent_last_name, phone, created_at
),
bind AS (UPDATE conversation.visitor v SET customer_id = f.id, last_seen = now() FROM f WHERE v.id = $2::text)
SELECT * FROM f;
