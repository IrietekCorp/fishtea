-- $1 requestId → the engagement on file for (employee email, organization), or null
SELECT coalesce((SELECT jsonb_build_object('title', e.title, 'startDate', e.start_date, 'endDate', e.end_date, 'status', e.status, 'kind', e.kind)
  FROM business.verification_request r JOIN business.organization o ON lower(o.name) = lower(r.organization_name)
  JOIN business.employee em ON em.email = r.employee_email AND lower(em.last_name) = lower(r.employee_last_name)
  JOIN business.engagement e ON e.employee_id = em.id AND e.organization_id = o.id
  WHERE r.id = $1::text ORDER BY e.start_date DESC LIMIT 1), 'null'::jsonb) AS engagement;
