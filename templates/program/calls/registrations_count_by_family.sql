-- $1 familyId
SELECT count(*)::int AS count FROM business.registration WHERE family_id = $1::text AND status <> 'withdrawn';
