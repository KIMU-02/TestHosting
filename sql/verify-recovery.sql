-- Executed only against the generated disposable restore database.
BEGIN;
SET LOCAL statement_timeout='30s';
DO $$
DECLARE product integer; before_stock integer; generated_id bigint; max_order bigint;
BEGIN
  IF current_database() !~ '^portfolio_restore_[0-9]{8}t[0-9]{9}z_[a-f0-9]{8}$' THEN
    RAISE EXCEPTION 'Refusing verification writes outside disposable restore database';
  END IF;
  IF EXISTS (SELECT FROM lab.products WHERE stock<0) THEN RAISE EXCEPTION 'Negative inventory'; END IF;
  IF (SELECT count(*) FROM lab.dataset) <> 1 THEN RAISE EXCEPTION 'Dataset metadata missing'; END IF;
  IF (SELECT count(*) FROM lab.orders WHERE source='history') <> (SELECT row_count FROM lab.dataset) THEN
    RAISE EXCEPTION 'Historical row count does not match dataset';
  END IF;
  IF EXISTS (SELECT FROM lab.order_requests r LEFT JOIN lab.orders o ON o.id=r.order_id
    WHERE o.id IS NULL OR o.customer_id<>r.customer_id OR o.product_id<>r.product_id OR o.quantity<>r.quantity) THEN
    RAISE EXCEPTION 'Invalid idempotency mapping';
  END IF;
  IF EXISTS (SELECT FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='lab' AND NOT c.convalidated) THEN
    RAISE EXCEPTION 'Unvalidated constraints';
  END IF;
  SELECT id,stock INTO product,before_stock FROM lab.products ORDER BY id LIMIT 1;
  IF product IS NULL THEN RAISE EXCEPTION 'No product restored'; END IF;
  -- Give the disposable fixture one unit even if original inventory is exhausted.
  UPDATE lab.products SET stock=stock+1 WHERE id=product;
  UPDATE lab.products SET stock=stock-1 WHERE id=product AND stock>=1;
  SELECT coalesce(max(id),0) INTO max_order FROM lab.orders;
  INSERT INTO lab.orders(customer_id,product_id,quantity,total_cents,status,source)
    SELECT 2147483647,id,1,price_cents,'paid','checkout' FROM lab.products WHERE id=product RETURNING id INTO generated_id;
  IF generated_id<=max_order THEN RAISE EXCEPTION 'Identity sequence behind orders'; END IF;
  UPDATE lab.orders SET status='cancelled' WHERE id=generated_id;
  UPDATE lab.products SET stock=stock+1 WHERE id=product;
  IF (SELECT stock FROM lab.products WHERE id=product)<>before_stock+1 THEN RAISE EXCEPTION 'Restored inventory write failed'; END IF;
END $$;
ROLLBACK;
SELECT json_build_object(
  'orders',(SELECT count(*) FROM lab.orders),
  'historical_orders',(SELECT count(*) FROM lab.orders WHERE source='history'),
  'paid_checkout_orders',(SELECT count(*) FROM lab.orders WHERE source='checkout' AND status='paid'),
  'cancelled_checkout_orders',(SELECT count(*) FROM lab.orders WHERE source='checkout' AND status='cancelled'),
  'products',(SELECT count(*) FROM lab.products),
  'stock_units',(SELECT sum(stock) FROM lab.products),
  'request_keys',(SELECT count(*) FROM lab.order_requests),
  'constraints_valid',true,'identity_and_write_probe','passed; transaction rolled back'
);
