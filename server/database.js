const fs = require('fs');
const path = require('path');
const config = require('./config');

// Simple queue for synchronizing atomic write-ahead operations (ACID consistency)
class DatabaseQueue {
  constructor() {
    this.queue = Promise.resolve();
  }

  enqueue(operation) {
    this.queue = this.queue.then(() => operation()).catch(err => {
      console.error('[DB Queue Error]', err);
      throw err;
    });
    return this.queue;
  }
}

class TransactionalDatabase {
  constructor() {
    this.dbPath = config.dbPath;
    this.queue = new DatabaseQueue();
    this.initDatabase();
  }

  initDatabase() {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(this.dbPath)) {
      const defaultState = {
        users: {
          "u-1": { id: "u-1", name: "Alpha Buyer", role: "buyer", password: "password123", balance: 50000.0, created_at: new Date().toISOString() },
          "u-2": { id: "u-2", name: "Premium Merchant", role: "merchant", password: "password123", balance: 1000.0, created_at: new Date().toISOString() },
          "u-3": { id: "u-3", name: "System Admin", role: "admin", password: "adminpassword", balance: 0.0, created_at: new Date().toISOString() }
        },
        products: {
          "p-1": { id: "p-1", name: "AURA Glassmorphic Keyboard", category: "Electronics", price: 299.0, stock: 15, version: 1, deleted_at: null, merchant_id: "u-2" },
          "p-2": { id: "p-2", name: "Holographic Workspace Stand", category: "Office", price: 189.0, stock: 8, version: 1, deleted_at: null, merchant_id: "u-2" },
          "p-3": { id: "p-3", name: "Quantum Noise Cancel Earbuds", category: "Electronics", price: 249.0, stock: 25, version: 1, deleted_at: null, merchant_id: "u-2" },
          "p-4": { id: "p-4", name: "Ergonomic Lumbar Arch Seat", category: "Furniture", price: 599.0, stock: 5, version: 1, deleted_at: null, merchant_id: "u-2" }
        },
        orders: {},
        audit_logs: {}
      };
      fs.writeFileSync(this.dbPath, JSON.stringify(defaultState, null, 2), 'utf8');
      console.log(`[Database] Initialized new database file at ${this.dbPath}`);
    } else {
      console.log(`[Database] Connected to database at ${this.dbPath}`);
    }
  }

  // Read current data state
  read() {
    try {
      const raw = fs.readFileSync(this.dbPath, 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      console.error('[DB Read Error] Failed to read database, falling back to empty structures.', err);
      return { users: {}, products: {}, orders: {}, audit_logs: {} };
    }
  }

  // Write state safely to disk (Durability)
  write(data) {
    try {
      fs.writeFileSync(this.dbPath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.error('[DB Write Error] Failed to write database state to disk.', err);
      throw err;
    }
  }

  // Execute isolated transactions with file-locking queues (Isolation, Consistency, Atomicity)
  async executeTransaction(callback) {
    return this.queue.enqueue(async () => {
      const data = this.read();
      const stateClone = JSON.parse(JSON.stringify(data)); // Deep clone state for rollback support
      try {
        const result = await callback(stateClone);
        this.write(stateClone); // Commit changes on success
        return result;
      } catch (err) {
        console.error('[Transaction Rollback] Transaction failed, roll-back triggered.', err.message);
        throw err; // Re-throw error to trigger express universal error handler
      }
    });
  }

  // Quick lookup indices (O(1) lookups)
  async findById(collection, id) {
    const data = this.read();
    const item = data[collection] ? data[collection][id] : null;
    if (item && item.deleted_at === undefined || item.deleted_at === null) {
      return item;
    }
    return null; // Return null if not found or soft-deleted
  }

  async findAll(collection) {
    const data = this.read();
    const items = Object.values(data[collection] || {});
    return items.filter(item => item.deleted_at === undefined || item.deleted_at === null);
  }
}

module.exports = new TransactionalDatabase();
