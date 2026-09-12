SELECT id, customer_id, total_cents, status, created_at
FROM lab.orders
WHERE customer_id = $1
ORDER BY created_at DESC, id DESC
LIMIT 50
