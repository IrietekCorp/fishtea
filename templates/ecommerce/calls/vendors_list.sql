-- $1 status
SELECT id, name, adapter, config, commission_pct, last_sync_at, status FROM business.vendor WHERE status = coalesce($1::text, 'active') ORDER BY name;
