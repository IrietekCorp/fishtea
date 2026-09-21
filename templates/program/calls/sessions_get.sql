-- $1 sessionId
SELECT s.id, s.name, s.start_date, s.end_date, s.capacity, s.price, s.age_min, s.age_max, s.hours, s.location, s.tracks, s.status, s.description,
       (s.capacity - (SELECT count(*) FROM business.registration r WHERE r.session_id = s.id AND r.status NOT IN ('withdrawn')))::int AS spots_left
FROM business.session s WHERE s.id = $1::text;
