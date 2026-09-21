-- $1 employeeEmail, $2 granted
WITH up AS (
  INSERT INTO business.employee (id, email, first_name, last_name, consent, consent_at)
  VALUES ('em_' || substr(md5(lower($1::text)), 1, 12), lower($1::text), '', '', CASE WHEN $2::boolean THEN 'granted' ELSE 'revoked' END, now())
  ON CONFLICT (email) DO UPDATE SET consent = excluded.consent, consent_at = now()
  RETURNING email, consent
),
moved AS (
  UPDATE business.verification_request r SET status = CASE WHEN $2::boolean THEN 'attesting' ELSE 'declined' END,
    events = r.events || jsonb_build_object('at', now(), 'status', CASE WHEN $2::boolean THEN 'attesting' ELSE 'declined' END, 'note', CASE WHEN $2::boolean THEN 'Consent granted; verifier notified' ELSE 'Consent revoked' END)
  FROM up WHERE r.employee_email = up.email AND r.status = 'consent-pending'
  RETURNING r.id
)
SELECT true AS ok, (SELECT count(*)::int FROM moved) AS moved;
