-- $1 requestId, $2 status, $3 result
UPDATE business.verification_request SET status = $2::text, result = $3::jsonb, events = events || jsonb_build_object('at', now(), 'status', $2::text, 'note', 'Attestation recorded')
WHERE id = $1::text
RETURNING id, requester_id, employee_email, employee_last_name, organization_name, claim_title, claim_start, claim_end, purpose, status, result, events, created_at, expires_at;
