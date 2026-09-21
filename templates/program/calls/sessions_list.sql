-- $1 age, $2 from — active sessions the age fits, with spots_left from enrolments
SELECT s.id, s.name, s.start_date, s.end_date, s.capacity, s.price, s.age_min, s.age_max, s.hours, s.location, s.tracks, s.status, s.description,
       (s.capacity - (SELECT count(*) FROM business.registration r WHERE r.session_id = s.id AND r.status NOT IN ('withdrawn')))::int AS spots_left
FROM business.session s
WHERE s.status = 'active'
  AND ($1::int IS NULL OR ($1::int BETWEEN s.age_min AND s.age_max))
  AND ($2::date IS NULL OR s.start_date >= $2::date)
ORDER BY s.start_date;
