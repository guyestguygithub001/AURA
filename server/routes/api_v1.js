const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const db = require('../database');
const { AppError } = require('../errors');
const { logAuditAction } = require('../audit');

// Authentication & Authorization middlewares
const requireAuth = async (req, res, next) => {
  const userId = req.headers['x-aura-user-id'];
  if (!userId) {
    return next(new AppError('Unauthorized: Missing X-Aura-User-Id credentials header', 401));
  }
  
  const user = await db.findById('users', userId);
  if (!user) {
    return next(new AppError('Unauthorized: Authenticated user context not found', 401));
  }
  
  req.user = user;
  next();
};

const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError('Unauthorized: User session not established', 401));
    }
    
    const hasRole = Array.isArray(roles) ? roles.includes(req.user.role) : req.user.role === roles;
    if (!hasRole) {
      return next(new AppError(`Forbidden: Access denied. Action requires role: ${roles}`, 403));
    }
    next();
  };
};

// 1. Get all products (Active only - Soft Delete filter)
router.get('/products', requireAuth, async (req, res, next) => {
  try {
    const products = await db.findAll('products');
    res.status(200).json({ status: 'success', results: products.length, data: { products } });
  } catch (err) {
    next(err);
  }
});

// 2. Create a product (Merchant listings)
router.post('/products', requireAuth, requireRole('merchant'), async (req, res, next) => {
  try {
    const { name, category, price, stock } = req.body;
    const merchantId = req.user.id; // Taken securely from headers context

    if (!name || !category || price === undefined || stock === undefined) {
      return next(new AppError('Missing required product parameters: name, category, price, stock', 400));
    }

    const priceNum = parseFloat(price);
    const stockNum = parseInt(stock, 10);

    if (isNaN(priceNum) || priceNum <= 0) return next(new AppError('Price must be a positive number', 400));
    if (isNaN(stockNum) || stockNum < 0) return next(new AppError('Stock cannot be negative', 400));

    const newProductId = `p-${Date.now()}`;
    const productRecord = {
      id: newProductId,
      name,
      category,
      price: priceNum,
      stock: stockNum,
      version: 1,
      deleted_at: null,
      merchant_id: merchantId
    };

    // Execute atomic write transaction
    await db.executeTransaction((state) => {
      state.products[newProductId] = productRecord;
    });

    // Record audit trail
    await logAuditAction({
      actor: merchantId,
      action: 'PRODUCT_CREATE',
      entityType: 'product',
      entityId: newProductId,
      afterState: productRecord,
      req
    });

    res.status(201).json({ status: 'success', data: { product: productRecord } });
  } catch (err) {
    next(err);
  }
});

// 3. Delete a product (Soft Delete - supports Admin role override)
router.delete('/products/:id', requireAuth, async (req, res, next) => {
  try {
    const productId = req.params.id;
    const user = req.user; // Resolved securely from headers context
    const actorId = user.id;

    const product = await db.findById('products', productId);
    if (!product) return next(new AppError('Product not found or already deleted', 404));

    const isAdmin = user.role === 'admin';
    const isOwner = product.merchant_id === actorId;

    if (!isAdmin && !isOwner) {
      return next(new AppError('Access denied: You must be the listing owner or an Administrator to delete this product', 403));
    }

    const beforeState = JSON.parse(JSON.stringify(product));
    let afterState;

    await db.executeTransaction((state) => {
      const prod = state.products[productId];
      prod.deleted_at = new Date().toISOString();
      afterState = prod;
    });

    await logAuditAction({
      actor: actorId,
      action: isAdmin ? 'PRODUCT_DELETE_ADMIN' : 'PRODUCT_DELETE',
      entityType: 'product',
      entityId: productId,
      beforeState,
      afterState,
      req
    });

    res.status(200).json({ status: 'success', message: isAdmin ? 'Product successfully moderated by Admin' : 'Product successfully soft-deleted.' });
  } catch (err) {
    next(err);
  }
});

// 4. Place an order (ACID Transaction with Stock Lock Check)
router.post('/orders', requireAuth, requireRole('buyer'), async (req, res, next) => {
  try {
    const { productId, quantity, expectedVersion } = req.body;
    const buyerId = req.user.id; // Securely resolved from header session context

    if (!productId || !quantity || expectedVersion === undefined) {
      return next(new AppError('Missing transaction parameters: productId, quantity, expectedVersion', 400));
    }

    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty <= 0) return next(new AppError('Quantity must be a positive integer', 400));

    const expectedVer = parseInt(expectedVersion, 10);
    if (isNaN(expectedVer)) return next(new AppError('expectedVersion must be an integer', 400));

    // Run transaction
    const transactionResult = await db.executeTransaction(async (state) => {
      // 1. Fetch user (buyer)
      const buyer = state.users[buyerId];
      if (!buyer || buyer.role !== 'buyer') {
        throw new AppError('Buyer profile not found', 404);
      }

      // 2. Fetch product
      const product = state.products[productId];
      if (!product || product.deleted_at !== null) {
        throw new AppError('Product is currently unavailable or has been deleted', 404);
      }

      // 3. Stock Check
      if (product.stock < qty) {
        throw new AppError(`Insufficient stock. Requested: ${qty}, Available: ${product.stock}`, 409);
      }

      // 4. Optimistic Lock Check (Prevent Race Conditions)
      if (product.version !== expectedVer) {
        throw new AppError('Product state has updated since you opened the checkout. Please refresh.', 409);
      }

      const totalCost = product.price * qty;

      // 5. Balance Check
      if (buyer.balance < totalCost) {
        throw new AppError(`Insufficient funds. Total: $${totalCost}, Balance: $${buyer.balance}`, 402);
      }

      // 6. Perform Mutation updates (ACID Consistency)
      const oldBuyerState = JSON.parse(JSON.stringify(buyer));
      const oldProductState = JSON.parse(JSON.stringify(product));

      buyer.balance -= totalCost; // Deduct funds from buyer
      product.stock -= qty;       // Deduct inventory
      product.version += 1;       // Version lock increment

      // Generate order record
      const orderId = `ord-${Date.now()}`;
      const feeAmount = totalCost * 0.05; // 5% fee
      const netMerchantPayout = totalCost - feeAmount;

      const orderRecord = {
        id: orderId,
        buyer_id: buyerId,
        product_id: productId,
        quantity: qty,
        total_amount: totalCost,
        fee_collected: feeAmount,
        net_merchant_payout: netMerchantPayout,
        merchant_id: product.merchant_id,
        status: 'PAID', // Escrow holding state
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      state.orders[orderId] = orderRecord;

      return {
        order: orderRecord,
        buyerState: { before: oldBuyerState, after: buyer },
        productState: { before: oldProductState, after: product }
      };
    });

    const { order, buyerState, productState } = transactionResult;

    // Log atomic audits
    await logAuditAction({
      actor: buyerId,
      action: 'ORDER_PLACE',
      entityType: 'order',
      entityId: order.id,
      afterState: order,
      req
    });

    await logAuditAction({
      actor: buyerId,
      action: 'INVENTORY_DEDUCT',
      entityType: 'product',
      entityId: productId,
      beforeState: productState.before,
      afterState: productState.after,
      req
    });

    await logAuditAction({
      actor: buyerId,
      action: 'BALANCE_DEDUCT',
      entityType: 'user',
      entityId: buyerId,
      beforeState: buyerState.before,
      afterState: buyerState.after,
      req
    });

    res.status(201).json({ status: 'success', data: { order } });
  } catch (err) {
    next(err);
  }
});

// 5. Merchant Ship order
router.post('/orders/:id/ship', requireAuth, requireRole('merchant'), async (req, res, next) => {
  try {
    const orderId = req.params.id;
    const merchantId = req.user.id; // Securely resolved from header session context

    const result = await db.executeTransaction(async (state) => {
      const order = state.orders[orderId];
      if (!order) throw new AppError('Order not found', 404);
      if (order.merchant_id !== merchantId) throw new AppError('Access denied: You are not authorized to dispatch this order', 403);
      if (order.status !== 'PAID') throw new AppError(`Cannot ship order in current status: ${order.status}`, 400);

      const oldState = JSON.parse(JSON.stringify(order));
      order.status = 'SHIPPED';
      order.updated_at = new Date().toISOString();

      return { order, before: oldState };
    });

    await logAuditAction({
      actor: merchantId,
      action: 'ORDER_SHIP',
      entityType: 'order',
      entityId: orderId,
      beforeState: result.before,
      afterState: result.order,
      req
    });

    res.status(200).json({ status: 'success', data: { order: result.order } });
  } catch (err) {
    next(err);
  }
});

// 6. Carrier/Buyer mark delivered (Escrow payout Release)
router.post('/orders/:id/deliver', requireAuth, async (req, res, next) => {
  try {
    const orderId = req.params.id;
    const user = req.user; // Resolved securely from headers context
    const actorId = user.id;

    // Validate access permission before proceeding
    const currentOrder = db.read().orders[orderId];
    if (!currentOrder) return next(new AppError('Order not found', 404));

    const isAdmin = user.role === 'admin';
    const isBuyer = currentOrder.buyer_id === actorId;
    const isMerchant = currentOrder.merchant_id === actorId;

    if (!isAdmin && !isBuyer && !isMerchant) {
      return next(new AppError('Access denied: You are not authorized to complete delivery for this order', 403));
    }

    const result = await db.executeTransaction(async (state) => {
      const order = state.orders[orderId];
      if (!order) throw new AppError('Order not found', 404);
      if (order.status !== 'SHIPPED') throw new AppError(`Cannot deliver order in current status: ${order.status}`, 400);

      const merchant = state.users[order.merchant_id];
      if (!merchant) throw new AppError('Merchant associated with order not found', 404);

      const oldOrderState = JSON.parse(JSON.stringify(order));
      const oldMerchantState = JSON.parse(JSON.stringify(merchant));

      // Release escrow balance to merchant account
      order.status = 'DELIVERED';
      order.updated_at = new Date().toISOString();

      merchant.balance += order.net_merchant_payout;

      return { order, merchant, beforeOrder: oldOrderState, beforeMerchant: oldMerchantState };
    });

    await logAuditAction({
      actor: actorId,
      action: 'ORDER_DELIVER',
      entityType: 'order',
      entityId: orderId,
      beforeState: result.beforeOrder,
      afterState: result.order,
      req
    });

    await logAuditAction({
      actor: 'ESCROW_SYSTEM',
      action: 'ESCROW_PAYOUT_MERCHANT',
      entityType: 'user',
      entityId: result.order.merchant_id,
      beforeState: result.beforeMerchant,
      afterState: result.merchant,
      req
    });

    res.status(200).json({ status: 'success', data: { order: result.order } });
  } catch (err) {
    next(err);
  }
});

// 7. Get users data (For sandbox visualization)
router.get('/users', requireAuth, async (req, res, next) => {
  try {
    const data = db.read();
    res.status(200).json({ status: 'success', data: { users: Object.values(data.users) } });
  } catch (err) {
    next(err);
  }
});

// 8. Get audit logs list (Admin console)
router.get('/audit-logs', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const data = db.read();
    // Sort logs descending by timestamp
    const logs = Object.values(data.audit_logs || {}).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    res.status(200).json({ status: 'success', data: { logs } });
  } catch (err) {
    next(err);
  }
});

// 9. Load legal policies dynamically
router.get('/policies/:policy', async (req, res, next) => {
  try {
    const policyName = req.params.policy.toUpperCase();
    const allowed = ['TOS', 'PRIVACY', 'DPA', 'REFUND', 'MSA'];
    if (!allowed.includes(policyName)) {
      return next(new AppError('Policy file not found', 404));
    }

    const filepath = path.join(__dirname, '..', '..', 'legal', `${policyName}.md`);
    if (!fs.existsSync(filepath)) {
      return next(new AppError(`Legal documentation for ${policyName} not yet drafted`, 404));
    }

    const content = fs.readFileSync(filepath, 'utf8');
    res.status(200).json({ status: 'success', data: { policy: policyName, content } });
  } catch (err) {
    next(err);
  }
});

// 10. User Onboarding & Sign-Up endpoint
router.post('/users/onboard', async (req, res, next) => {
  try {
    const { id, name, password, role, balance } = req.body;

    if (!id || !name || !password || !role) {
      return next(new AppError('Missing onboarding parameters: id, name, password, role', 400));
    }

    if (role !== 'buyer' && role !== 'merchant') {
      return next(new AppError('Role must be either "buyer" or "merchant"', 400));
    }

    const startingBalance = parseFloat(balance) || (role === 'buyer' ? 5000.0 : 0.0);
    if (isNaN(startingBalance) || startingBalance < 0) {
      return next(new AppError('Starting balance cannot be negative', 400));
    }

    const result = await db.executeTransaction(async (state) => {
      if (state.users[id]) {
        throw new AppError(`A user with the identity "${id}" is already registered. Please choose another username.`, 409);
      }

      const userRecord = {
        id,
        name,
        password,
        role,
        balance: startingBalance,
        created_at: new Date().toISOString()
      };

      state.users[id] = userRecord;
      return userRecord;
    });

    await logAuditAction({
      actor: id,
      action: 'USER_ONBOARD',
      entityType: 'user',
      entityId: id,
      afterState: result,
      req
    });

    res.status(201).json({ status: 'success', data: { user: result } });
  } catch (err) {
    next(err);
  }
});

// 11. User Login / Authentication
router.post('/users/login', async (req, res, next) => {
  try {
    const { id, password } = req.body;

    if (!id || !password) {
      return next(new AppError('Missing credentials: id, password', 400));
    }

    // Lookup user in DB
    const users = db.read().users;
    const user = users[id];

    if (!user) {
      return next(new AppError('Invalid identity handle', 401));
    }

    if (user.password !== password) {
      return next(new AppError('Invalid password credential', 401));
    }

    // Log login audit trail
    await logAuditAction({
      actor: id,
      action: 'USER_LOGIN',
      entityType: 'user',
      entityId: id,
      afterState: { id: user.id, name: user.name, role: user.role },
      req
    });

    res.status(200).json({
      status: 'success',
      data: {
        user: {
          id: user.id,
          name: user.name,
          role: user.role,
          balance: user.balance
        }
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
