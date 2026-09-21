SELECT q.id, q.topic, q.question, q.answer, q.follow_ups, q."order" FROM business.question q JOIN unnest($1::text[]) WITH ORDINALITY AS w(id, ord) ON w.id = q.id ORDER BY w.ord;
