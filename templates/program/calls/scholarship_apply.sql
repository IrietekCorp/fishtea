-- $1 familyId, $2 registrationId, $3 need, $4 amountRequested
INSERT INTO business.scholarship (id, registration_id, family_id, need, amount_requested, status, created_at)
SELECT 'sch_' || substr(md5(random()::text), 1, 8), r.id, $1::text, $3::text, coalesce($4::numeric, 450), 'applied', now()
FROM business.registration r WHERE r.id = $2::text AND r.family_id = $1::text
RETURNING id, registration_id, family_id, need, amount_requested, status, sponsor_id, created_at;
