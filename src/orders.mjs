import { shared } from './db.mjs';

export class OutOfStock extends Error {
  constructor() { super('Product unavailable or insufficient stock'); this.status = 409; }
}

// afterRead is a test-only scheduling hook. It is never accepted by the HTTP API.
export async function placeOrder(client, {
  mode = 'safe', customerId, productId = 1, quantity = 1,
  afterRead, coordinated = true, requestKey
}) {
  if (!['safe', 'unsafe'].includes(mode)) throw new Error('Unknown mode');
  await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  try {
    if (coordinated) await shared(client);
    if (requestKey !== undefined) {
      if (typeof requestKey !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(requestKey)) throw Object.assign(new Error('Invalid Idempotency-Key'), {status:400});
      const inserted = await client.query(`INSERT INTO lab.order_requests(customer_id,request_key,product_id,quantity)
        VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING request_key`, [customerId,requestKey,productId,quantity]);
      if (!inserted.rowCount) {
        const {rows:[previous]} = await client.query('SELECT * FROM lab.order_requests WHERE customer_id=$1 AND request_key=$2',[customerId,requestKey]);
        if (previous.product_id !== productId || previous.quantity !== quantity) throw Object.assign(new Error('Idempotency key already used with different order'),{status:409});
        await client.query('COMMIT');
        return {id:previous.order_id,replayed:true};
      }
    }
    let product;
    if (mode === 'unsafe' || afterRead) {
      const { rows } = await client.query('SELECT stock, price_cents FROM lab.products WHERE id=$1', [productId]);
      product = rows[0];
      if (afterRead) await afterRead();
    }
    let price;
    if (mode === 'unsafe') {
      if (!product || product.stock < quantity) throw new OutOfStock();
      // Intentional lost update: stock from a stale SELECT overwrites newer stock.
      // CHECK(stock >= 0) still passes, even when more orders than stock commit.
      await client.query('UPDATE lab.products SET stock=$1 WHERE id=$2', [product.stock - quantity, productId]);
      price = product.price_cents;
    } else {
      const { rows } = await client.query(`
        UPDATE lab.products SET stock=stock-$1
        WHERE id=$2 AND stock >= $1
        RETURNING price_cents`, [quantity, productId]);
      if (!rows.length) throw new OutOfStock();
      price = rows[0].price_cents;
    }
    const { rows } = await client.query(`
      INSERT INTO lab.orders(customer_id, product_id, quantity, total_cents, status, source)
      VALUES ($1,$2,$3,$4,'paid','checkout') RETURNING id`,
    [customerId, productId, quantity, price * quantity]);
    if (requestKey !== undefined) await client.query('UPDATE lab.order_requests SET order_id=$1 WHERE customer_id=$2 AND request_key=$3',[rows[0].id,customerId,requestKey]);
    await client.query('COMMIT');
    return rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export async function cancelOrder(client, {orderId, customerId}) {
  await client.query('BEGIN');
  try {
    await shared(client);
    const {rows:[order]} = await client.query('SELECT * FROM lab.orders WHERE id=$1 AND customer_id=$2 FOR UPDATE',[orderId,customerId]);
    if (!order) throw Object.assign(new Error('Order not found'),{status:404});
    if (order.source !== 'checkout') throw Object.assign(new Error('Historical experiment orders cannot be cancelled'),{status:409});
    const replayed = order.status === 'cancelled';
    if (!replayed) {
      await client.query('UPDATE lab.products SET stock=stock+$1 WHERE id=$2',[order.quantity,order.product_id]);
      await client.query("UPDATE lab.orders SET status='cancelled' WHERE id=$1",[orderId]);
    }
    await client.query('COMMIT');
    return {id:order.id,status:'cancelled',replayed};
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}
