-- $1 vendorId
UPDATE business.vendor SET last_sync_at = now() WHERE id = $1::text RETURNING id, name, adapter, config, commission_pct, last_sync_at, status;
