-- Seed command replaces ONLY the dedicated lab schema, under an exclusive lock.
DROP SCHEMA IF EXISTS lab CASCADE;
CREATE SCHEMA lab;
CREATE TABLE lab.products (
  id integer PRIMARY KEY,
  name text NOT NULL,
  stock integer NOT NULL CHECK (stock >= 0),
  price_cents integer NOT NULL CHECK (price_cents > 0)
);
CREATE TABLE lab.orders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id integer NOT NULL CHECK (customer_id > 0),
  product_id integer NOT NULL REFERENCES lab.products(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  total_cents bigint NOT NULL CHECK (total_cents > 0),
  status text NOT NULL CHECK (status IN ('paid', 'cancelled')),
  source text NOT NULL CHECK (source IN ('history', 'checkout')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE lab.dataset (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  version text NOT NULL,
  row_count integer NOT NULL,
  seeded_at timestamptz NOT NULL DEFAULT now()
);
