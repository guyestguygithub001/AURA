# AURA MARKETPLACE SUPPORT PLAYBOOK

This playbook outlines operations, diagnostic steps, error mitigation paths, and transaction troubleshooting procedures for AURA Marketplace Customer Support, System Administrators, and Engineering teams.

---

## 1. System Architecture Overview

AURA is structured as a decoupled web application leveraging a versioned REST API (`/api/v1`) running on Express, connected to a transactional data grid with file-based persistence.

- **Frontend Core**: Rich glassmorphic SPA (`public/index.html`, `public/styles.css`, `public/app.js`).
- **Backend API**: Node.js microservices shell (`server/server.js`, `server/routes/api_v1.js`).
- **Data Engine**: ACID-compliant transactional grid (`server/database.js`).
- **Audit Logging**: Structured log captures (`server/audit.js`).
- **Config Separation**: Local environment scripts (`.env.development`, `.env.production`).

---

## 2. Common Support Scenarios & Resolution Workflows

### Scenario 1: Transaction Rollback (Optimistic Lock Failure)
- **Problem**: Buyer receives an alert: *"Product state has updated since you opened the checkout. Please refresh."*
- **Technical Explanation**: This is caused by the **Database Optimistic Locking Principle**. If two buyers attempt to purchase the same item at the same millisecond, the first transaction updates the product `version` index. The second buyer's expected version fails validation.
- **Resolution Steps**:
  1. The UI automatically catches the `409 Conflict` HTTP error response from `/api/v1/orders`.
  2. The system triggers a silent refresh of the catalog state (re-fetching `GET /api/v1/products`).
  3. Direct the customer to re-add the item to their cart and checkout again. If stock is depleted, the UI will reflect "Sold Out".

### Scenario 2: Escrow Payout Not Released to Merchant
- **Problem**: Merchant complains that their order is marked "Delivered" but their wallet balance has not increased.
- **Technical Explanation**: In the multi-party split escrow model, payouts are held in escrow. Payout release requires a state transition trigger (`ORDER_DELIVER` action) from the carrier API or buyer.
- **Resolution Steps**:
  1. Inspect the system's **Audit Trail Logs** (via `GET /api/v1/audit-logs` or the Admin panel).
  2. Locate the Order ID (e.g. `ord-1700000000000`).
  3. Verify the order's status:
     - If status is `PAID` or `SHIPPED`: Payout cannot be released yet. The item must be dispatched by the merchant (`POST /api/v1/orders/:id/ship`) and marked delivered (`POST /api/v1/orders/:id/deliver`).
     - If status is `DELIVERED` but balance failed to update, check backend system console logs for database transaction rollback errors.

### Scenario 3: Soft Delete vs Historical Order Conflict
- **Problem**: Merchant soft-deletes a product listing, and customers ask why their past orders of that product still show in their dashboard.
- **Technical Explanation**: AURA uses **Soft Deletes** (`deleted_at` timestamp) instead of physical deletion. This preserves relational integrity so past orders can reference product details, while hiding active listings from the public store catalog.
- **Resolution Steps**:
  1. No support action required. Inform the customer that past orders are kept for transaction records.
  2. Confirm that the product is excluded from search by verifying it does not appear in `GET /api/v1/products`.

---

## 3. System Diagnostic CLI Guide

### Viewing System Logs
To inspect live network requests and database modifications, use the **AURA Architecture Ledger** at the bottom of the dashboard viewport.
- **`[API Request]`** (Purple): Shows incoming REST transactions with payload parameters.
- **`[DB Update]`** (Yellow): Shows ACID mutations, including exact stock version changes and balance adjustments.
- **`[System]`** (Teal): Client-side routing adjustments and lifecycle events.
- **`[Error]`** (Red): Catches and logs all unified API exceptions.

### Checking Environment Configurations
1. Access the project directory: `C:\Users\HP\.gemini\antigravity\scratch\fluid-marketplace`
2. Check `.env.development` (Local Port `8082`, `data.dev.json` db)
3. Check `.env.production` (Production port, `data.prod.json` db, secure error reporting)

---

## 4. Universal Error Handling Matrix

AURA returns standard JSON error responses under the `AppError` class:

| HTTP Status | Error Status | Typical Cause | Resolution |
| :--- | :--- | :--- | :--- |
| **400** | `fail` | Missing transaction/product params, invalid numbers | Correct JSON body payload |
| **401** | `fail` | Unauthorized access (missing client credentials) | Supply valid User ID context |
| **402** | `fail` | Insufficient funds in buyer wallet | Fund buyer wallet balance |
| **403** | `fail` | Forbidden (e.g., Merchant trying to ship another vendor's order) | Assert user authorization rights |
| **404** | `fail` | Product/Order not found or soft-deleted | Verify resource ID exists |
| **409** | `fail` | Stock depletion or version lock mismatch | Refresh inventory and retry |
| **500** | `error` | Database write exception or code exception | Contact engineering tier-2 |
