SELECT id, name, tier, amount, website_url, description FROM business.sponsor ORDER BY (tier = 'full') DESC, amount DESC, name;
