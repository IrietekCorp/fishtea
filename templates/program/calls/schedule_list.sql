-- $1 sessionId
SELECT id, session_id, day, title, description, start_time, end_time, location
FROM business.event WHERE session_id = $1::text ORDER BY day, start_time;
