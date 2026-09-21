-- $1 requesterId, $2 employeeEmail, $3 employeeLastName, $4 organizationName, $5 claimTitle, $6 claimStart, $7 claimEnd, $8 purpose, $9 ttlDays
-- consent gate: if the employee has granted consent already, go straight to attesting; else consent-pending
WITH emp AS (SELECT consent FROM business.employee WHERE email = lower($2::text)),
ins AS (
  INSERT INTO business.verification_request (id, requester_id, employee_email, employee_last_name, organization_name, claim_title, claim_start, claim_end, purpose, status, events, created_at, expires_at)
  SELECT 'vr_' || substr(md5(random()::text), 1, 10), $1::text, lower($2::text), $3::text, $4::text, $5::text, $6::date, $7::date, $8::text,
         CASE WHEN (SELECT consent FROM emp) = 'granted' THEN 'attesting' ELSE 'consent-pending' END,
         jsonb_build_array(jsonb_build_object('at', now(), 'status', 'requested', 'note', 'Request received'),
                           jsonb_build_object('at', now(), 'status', CASE WHEN (SELECT consent FROM emp) = 'granted' THEN 'attesting' ELSE 'consent-pending' END, 'note', CASE WHEN (SELECT consent FROM emp) = 'granted' THEN 'Consent on file; verifier notified' ELSE 'Employee asked for consent' END)),
         now(), now() + make_interval(days => coalesce($9::int, 14))
  RETURNING *
)
SELECT id, requester_id, employee_email, employee_last_name, organization_name, claim_title, claim_start, claim_end, purpose, status, result, events, created_at, expires_at FROM ins;
