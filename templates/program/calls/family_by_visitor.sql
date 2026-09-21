-- $1 visitorId
SELECT f.id, f.email, f.parent_first_name, f.parent_last_name, f.phone, f.created_at
FROM business.family f JOIN conversation.visitor v ON v.customer_id = f.id WHERE v.id = $1::text;
