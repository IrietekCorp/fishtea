-- $1 familyId, $2 camperId, $3 sessionId, $4 status, $5 price, $6 siblingDiscount
-- transaction: re-check capacity under lock so two parents can't take the last spot
WITH s AS (SELECT id, capacity FROM business.session WHERE id = $3::text FOR UPDATE),
taken AS (SELECT count(*) AS n FROM business.registration WHERE session_id = $3::text AND status <> 'withdrawn'),
ins AS (
  INSERT INTO business.registration (id, family_id, camper_id, session_id, status, payment_status, price, sibling_discount, events, created_at)
  SELECT 'reg_' || substr(md5(random()::text), 1, 8), $1::text, $2::text, s.id,
         CASE WHEN taken.n >= s.capacity THEN 'waitlisted' ELSE $4::text END,
         'unpaid', $5::numeric, coalesce($6::numeric, 0),
         jsonb_build_array(jsonb_build_object('at', now(), 'status', CASE WHEN taken.n >= s.capacity THEN 'waitlisted' ELSE $4::text END, 'note', 'Registration received')),
         now()
  FROM s, taken
  RETURNING *
)
SELECT id, family_id, camper_id, session_id, status, payment_status, price, sibling_discount, events, created_at FROM ins;
