-- $1 verifierEmail → requests in attesting for orgs this email may attest for, with the engagement on file (if any)
SELECT jsonb_agg(jsonb_build_object('id', r.id, 'employee', r.employee_last_name, 'claimTitle', r.claim_title, 'claimStart', r.claim_start, 'claimEnd', r.claim_end, 'purpose', r.purpose, 'onFile', (SELECT jsonb_build_object('title', e.title, 'startDate', e.start_date, 'endDate', e.end_date, 'status', e.status) FROM business.engagement e JOIN business.employee em ON em.id = e.employee_id WHERE em.email = r.employee_email AND e.organization_id = o.id LIMIT 1)) ORDER BY r.created_at) AS pending
FROM business.verification_request r
JOIN business.organization o ON lower(o.name) = lower(r.organization_name)
WHERE r.status = 'attesting' AND lower($1::text) = ANY(SELECT lower(unnest(o.verifier_emails)));
