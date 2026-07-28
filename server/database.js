const fs = require('fs');
const path = require('path');
const config = require('./config');

// Simple queue for synchronizing serializable transactional writes (Isolation)
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

// Software Transactional Memory (STM) session tracking copy-on-read mutations (Atomicity & Consistency)
class TransactionSession {
  constructor(masterState) {
    this.masterState = masterState;
    this.shadowState = {
      users: {},
      products: {},
      orders: {},
      audit_logs: {}
    };
    this.touched = {
      users: new Set(),
      products: new Set(),
      orders: new Set(),
      audit_logs: new Set()
    };
  }

  _get(collection, id) {
    if (this.touched[collection].has(id)) {
      return this.shadowState[collection][id];
    }
    const original = this.masterState[collection][id];
    if (original) {
      this.shadowState[collection][id] = JSON.parse(JSON.stringify(original));
    } else {
      this.shadowState[collection][id] = null;
    }
    this.touched[collection].add(id);
    return this.shadowState[collection][id];
  }

  _set(collection, id, val) {
    this.shadowState[collection][id] = val;
    this.touched[collection].add(id);
  }

  get users() {
    return new Proxy(this.masterState.users, {
      get: (target, prop) => {
        if (prop === 'then' || typeof prop === 'symbol') return undefined;
        return this._get('users', prop);
      },
      set: (target, prop, value) => {
        this._set('users', prop, value);
        return true;
      }
    });
  }

  get products() {
    return new Proxy(this.masterState.products, {
      get: (target, prop) => {
        if (prop === 'then' || typeof prop === 'symbol') return undefined;
        return this._get('products', prop);
      },
      set: (target, prop, value) => {
        this._set('products', prop, value);
        return true;
      }
    });
  }

  get orders() {
    return new Proxy(this.masterState.orders, {
      get: (target, prop) => {
        if (prop === 'then' || typeof prop === 'symbol') return undefined;
        return this._get('orders', prop);
      },
      set: (target, prop, value) => {
        this._set('orders', prop, value);
        return true;
      }
    });
  }

  get audit_logs() {
    return new Proxy(this.masterState.audit_logs, {
      get: (target, prop) => {
        if (prop === 'then' || typeof prop === 'symbol') return undefined;
        return this._get('audit_logs', prop);
      },
      set: (target, prop, value) => {
        this._set('audit_logs', prop, value);
        return true;
      }
    });
  }

  commit() {
    const changes = [];
    for (const collection of ['users', 'products', 'orders', 'audit_logs']) {
      for (const id of this.touched[collection]) {
        const val = this.shadowState[collection][id];
        if (val === null) {
          delete this.masterState[collection][id];
          changes.push({ action: 'delete', collection, id });
        } else {
          this.masterState[collection][id] = val;
          changes.push({ action: 'set', collection, id, val });
        }
      }
    }
    return changes;
  }
}

class TransactionalDatabase {
  constructor() {
    this.dbPath = config.dbPath;
    this.walPath = this.dbPath + '.wal';
    this.queue = new DatabaseQueue();
    this.state = { users: {}, products: {}, orders: {}, audit_logs: {} };
    this.initDatabase();
  }

  initDatabase() {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // 1. Load initial baseline snapshot
    let baselineState;
    if (!fs.existsSync(this.dbPath)) {
      baselineState = {
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
      fs.writeFileSync(this.dbPath, JSON.stringify(baselineState, null, 2), 'utf8');
      console.log(`[Database] Seeded new baseline state at ${this.dbPath}`);
    } else {
      try {
        const raw = fs.readFileSync(this.dbPath, 'utf8');
        baselineState = JSON.parse(raw);
        console.log(`[Database] Loaded baseline state from snapshot`);
      } catch (err) {
        console.error('[DB Init Error] Snapshot corrupted. Instantiating clean data.', err);
        baselineState = { users: {}, products: {}, orders: {}, audit_logs: {} };
      }
    }

    this.state = baselineState;

    // 2. Replay journals for Durability (handles flushing WAL + standard active WAL)
    const journals = [this.walPath + '.flushing', this.walPath];
    let replayCount = 0;
    
    for (const journalPath of journals) {
      if (fs.existsSync(journalPath) && fs.statSync(journalPath).size > 0) {
        try {
          const content = fs.readFileSync(journalPath, 'utf8');
          const lines = content.split('\n').filter(line => line.trim() !== '');
          for (const line of lines) {
            const changes = JSON.parse(line);
            for (const change of changes) {
              if (!this.state[change.collection]) this.state[change.collection] = {};
              if (change.action === 'set') {
                this.state[change.collection][change.id] = change.val;
              } else if (change.action === 'delete') {
                delete this.state[change.collection][change.id];
              }
            }
          }
          replayCount += lines.length;
          fs.unlinkSync(journalPath);
        } catch (err) {
          console.error(`[DB WAL Replay Error] Failed to process journal: ${journalPath}`, err);
        }
      }
    }

    if (replayCount > 0) {
      console.log(`[Database] Replayed ${replayCount} transactions from log journal. Consolidated database snapshot.`);
      fs.writeFileSync(this.dbPath, JSON.stringify(this.state, null, 2), 'utf8');
    }

    this.txCount = 0;
    this.dirty = false;
    this.isFlushing = false;

    // Flush dirty buffers to disk asynchronously every 5 seconds to reduce Disk I/O load
    this.flushScheduler = setInterval(() => {
      if (this.dirty && !this.isFlushing) {
        this.flushToDisk();
      }
    }, 5000);
  }

  // Returns direct read reference for microsecond speed lookups
  read() {
    return this.state;
  }

  // Overwrites master state (useful for direct seeding/resets)
  write(data) {
    this.state = data;
    this.dirty = true;
  }

  // Execute serializable database transaction (Atomicity, Consistency, Isolation, Durability)
  async executeTransaction(callback) {
    return this.queue.enqueue(async () => {
      const session = new TransactionSession(this.state);
      try {
        const result = await callback(session);
        const changes = session.commit();

        if (changes.length > 0) {
          // Sync append transaction records to active WAL log (Durability hotpath)
          fs.appendFileSync(this.walPath, JSON.stringify(changes) + '\n', 'utf8');
          this.dirty = true;
          this.txCount++;

          // Force disk flush if transaction log buffer hits threshold
          if (this.txCount >= 100) {
            this.txCount = 0;
            this.flushToDisk();
          }
        }

        return result;
      } catch (err) {
        console.error('[DB Transaction Error] Rolled back transaction execution.', err.message);
        throw err;
      }
    });
  }

  // Non-blocking asynchronous database flusher (Optimized Snapshotting)
  flushToDisk() {
    if (this.isFlushing) return;
    this.isFlushing = true;
    
    const flushingWalPath = this.walPath + '.flushing';
    
    try {
      if (fs.existsSync(this.walPath)) {
        fs.renameSync(this.walPath, flushingWalPath);
      }
      
      const snapshot = JSON.stringify(this.state, null, 2);
      
      fs.writeFile(this.dbPath, snapshot, 'utf8', (err) => {
        this.isFlushing = false;
        if (err) {
          console.error('[DB Flush Failure] Snapshot write failed.', err);
          if (fs.existsSync(flushingWalPath)) {
            try {
              const content = fs.readFileSync(flushingWalPath, 'utf8');
              fs.appendFileSync(this.walPath, content, 'utf8');
              fs.unlinkSync(flushingWalPath);
            } catch (mergeErr) {
              console.error('[DB WAL Merge Error] Failed to restore WAL logs.', mergeErr);
            }
          }
        } else {
          this.dirty = false;
          fs.unlink(flushingWalPath, (unlinkErr) => {
            if (unlinkErr && unlinkErr.code !== 'ENOENT') {
              console.error('[DB WAL Clean Error] Failed to delete flushing journal.', unlinkErr);
            }
          });
        }
      });
    } catch (err) {
      this.isFlushing = false;
      console.error('[DB Flush Init Error]', err);
    }
  }

  async findById(collection, id) {
    const item = this.state[collection] ? this.state[collection][id] : null;
    if (item && (item.deleted_at === undefined || item.deleted_at === null)) {
      return item;
    }
    return null;
  }

  async findAll(collection) {
    const items = Object.values(this.state[collection] || {});
    return items.filter(item => item.deleted_at === undefined || item.deleted_at === null);
  }
}

module.exports = new TransactionalDatabase();
