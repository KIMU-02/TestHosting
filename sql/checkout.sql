-- Additive migration; existing orders and inventory are preserved.
CREATE TABLE IF NOT EXISTS lab.order_requests (
  customer_id integer NOT NULL,
  request_key text NOT NULL CHECK (length(request_key) BETWEEN 8 AND 100),
  product_id integer NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  order_id bigint REFERENCES lab.orders(id) ON DELETE CASCADE,
  PRIMARY KEY (customer_id, request_key)
);
