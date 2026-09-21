-- $1 requesterId → { requests, events }
WITH r AS (SELECT * FROM business.verification_request WHERE requester_id = $1::text ORDER BY created_at),
ev AS (SELECT e || jsonb_build_object('title', r.organization_name || ' · ' || r.employee_last_name) AS e FROM r, jsonb_array_elements(r.events) e)
SELECT coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'organization', r.organization_name, 'employee', r.employee_last_name, 'status', r.status, 'purpose', r.purpose, 'result', r.result, 'expiresAt', r.expires_at)) FROM r), '[]'::jsonb) AS requests,
       coalesce((SELECT jsonb_agg(e ORDER BY e->>'at') FROM ev), '[]'::jsonb) AS events;
