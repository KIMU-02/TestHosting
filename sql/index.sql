CREATE INDEX orders_customer_recent_idx
ON lab.orders (customer_id, created_at DESC, id DESC)
INCLUDE (total_cents, status)
