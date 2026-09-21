-- $1 familyId, $2 firstName, $3 lastName, $4 age, $5 experience, $6 allergies
INSERT INTO business.camper (id, family_id, first_name, last_name, age, experience, allergies, created_at)
VALUES ('cmp_' || substr(md5(random()::text), 1, 8), $1::text, $2::text, $3::text, $4::int, coalesce($5::text, 'none'), $6::text, now())
RETURNING id, family_id, first_name, last_name, age, experience, allergies, created_at;
