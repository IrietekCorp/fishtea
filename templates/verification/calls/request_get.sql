-- $1 requestId, $2 requesterId ('*' = any, used by the verifier path)
SELECT id, requester_id, employee_email, employee_last_name, organization_name, claim_title, claim_start, claim_end, purpose, status, result, events, created_at, expires_at
FROM business.verification_request WHERE id = $1::text AND ($2::text = '*' OR requester_id = $2::text);
