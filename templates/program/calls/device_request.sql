-- $1 familyId, $2 registrationId, $3 device
INSERT INTO business.device_loan (id, registration_id, family_id, device, status, created_at)
SELECT 'dev_' || substr(md5(random()::text), 1, 8), r.id, $1::text, $3::text, 'requested', now()
FROM business.registration r WHERE r.id = $2::text AND r.family_id = $1::text
  AND NOT EXISTS (SELECT 1 FROM business.device_loan d WHERE d.registration_id = r.id AND d.status <> 'returned')
RETURNING id, registration_id, family_id, device, status, created_at;
