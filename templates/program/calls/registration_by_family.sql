-- $1 familyId → { registrations: [...], events: [...] }
WITH regs AS (
  SELECT r.id, r.status, r.payment_status AS "paymentStatus", r.price, r.sibling_discount AS "siblingDiscount", r.created_at AS "createdAt",
         c.first_name AS "camper", c.age, s.name AS "session", s.start_date AS "startDate",
         (SELECT jsonb_agg(jsonb_build_object('status', sc.status, 'amount', sc.amount_requested)) FROM business.scholarship sc WHERE sc.registration_id = r.id) AS scholarships,
         (SELECT jsonb_agg(jsonb_build_object('device', d.device, 'status', d.status)) FROM business.device_loan d WHERE d.registration_id = r.id) AS devices,
         r.events
  FROM business.registration r
  JOIN business.camper c ON c.id = r.camper_id
  JOIN business.session s ON s.id = r.session_id
  WHERE r.family_id = $1::text
  ORDER BY r.created_at
),
ev AS (
  SELECT e || jsonb_build_object('title', regs."camper" || ' · ' || regs."session") AS e
  FROM regs, jsonb_array_elements(regs.events) e
  UNION ALL
  SELECT jsonb_build_object('at', sc.created_at, 'status', 'scholarship ' || sc.status, 'note', 'Scholarship request for $' || sc.amount_requested, 'title', sc.registration_id)
  FROM business.scholarship sc WHERE sc.family_id = $1::text
  UNION ALL
  SELECT jsonb_build_object('at', d.created_at, 'status', 'device ' || d.status, 'note', d.device || ' loan', 'title', d.registration_id)
  FROM business.device_loan d WHERE d.family_id = $1::text
)
SELECT coalesce((SELECT jsonb_agg(to_jsonb(regs) - 'events') FROM regs), '[]'::jsonb) AS registrations,
       coalesce((SELECT jsonb_agg(e ORDER BY e->>'at') FROM ev), '[]'::jsonb) AS events;
