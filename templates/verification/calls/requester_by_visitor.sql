SELECT r.id, r.email, r.name, r.organization, r.purpose, r.created_at FROM business.requester r JOIN conversation.visitor v ON v.customer_id = r.id WHERE v.id = $1::text;
