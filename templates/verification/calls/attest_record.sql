-- $1 requestId, $2 verifierEmail, $3 confirms, $4 note — only for requests in attesting whose org lists this verifier
INSERT INTO business.attestation (id, request_id, verifier_email, confirms, note, at)
SELECT 'at_' || substr(md5(random()::text), 1, 10), r.id, lower($2::text), $3::boolean, $4::text, now()
FROM business.verification_request r JOIN business.organization o ON lower(o.name) = lower(r.organization_name)
WHERE r.id = $1::text AND r.status = 'attesting' AND lower($2::text) = ANY(SELECT lower(unnest(o.verifier_emails)))
RETURNING id, request_id, verifier_email, confirms, note, at;
