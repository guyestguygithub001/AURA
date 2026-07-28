# AURA MARKETPLACE SUPPORT PLAYBOOK (PHASE 2)

This playbook outlines operations, diagnostic steps, error mitigation paths, and transaction troubleshooting procedures for AURA Marketplace Customer Support, System Administrators, and Engineering teams.

---

## 1. System Architecture Overview

AURA is structured as a decoupled web application leveraging a versioned REST API (`/api/v1`) running on Express, connected to a transactional data grid with file-based persistence.

- **Frontend Core**: Rich glassmorphic SPA (`public/index.html`, `--light-theme` overlays, `public/app.js`).
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

### Scenario 4: Admin Moderation Purges
- **Problem**: Merchant complains that their product listing has disappeared.
- **Technical Explanation**: Administrators (`u-3` or custom admin accounts) can moderate listings. When moderated, a `PRODUCT_DELETE_ADMIN` audit event is logged, and the product is soft-deleted.
- **Resolution Steps**:
  1. Search audit logs for `PRODUCT_DELETE_ADMIN` containing the product ID.
  2. Identify the Admin actor who performed the moderation.
  3. Reference internal compliance logs for the rationale (e.g., policy violations, inappropriate content).

### Scenario 5: User Onboarding Username Collision
- **Problem**: A new user receives an onboarding error: *"A user with the identity X is already registered."*
- **Technical Explanation**: The ID field serves as a unique primary key index in the database. Duplicate entries are blocked at the database boundary to enforce consistency and prevent credential overrides.
- **Resolution Steps**:
  1. Direct the user to choose a different, unique handle.
  2. Confirm the username is indeed occupied by querying `/api/v1/users`.

---

## 3. High-Scale Operations & Telemetry

When scaling AURA to **10-50M daily active users**, support operations utilize the following infrastructure systems:
- **Cloudflare Edge Analytics**: Monitoring edge KV cache hit-rates (target: >90% hit-rate). Low hit-rates cause database load surges.
- **CockroachDB Console**: Tracking replication latency across nodes and transaction retry rates. High retry rates suggest locking conflicts on hot product listings.
- **Kafka Lag Monitoring**: Ensuring the consumers responsible for payment, inventory updates, and notifications are processing events in real time.

---

## 4. Production Security Checklist

- **API Header Authentication**: All client-side requests must append the secure identity token header (`X-Aura-User-Id`). Raw anonymous calls (except `/users/onboard` and `/users/login`) are blocked.
- **Backend Actor Resolution**: Endpoint handlers must resolve the active actor (`buyer_id`, `merchant_id`) directly from the verified header context (`req.user.id`) rather than request payloads, preventing parameter spoofing.
- **OAuth2 Token Verification**: In production, JWT signatures must be validated by the API Gateway using JWKS endpoints.
- **Rate-Limiter Rules**: Gateway rejects requests exceeding 100 requests/minute per client IP (returning `429 Too Many Requests`).
- **SQL Injection Prevention**: Verify all queries pass parameterized inputs.
- **PCI Scope Compliance**: Verify Stripe SDK tokens are used and no raw PAN (Primary Account Number) logs are captured in audit databases.

---

## 5. Security & RBAC Support Workflows

### Scenario 6: 401 Unauthorized Response
- **Problem**: User receives an error popup: *"Unauthorized: Missing X-Aura-User-Id credentials header"* or *"Unauthorized: Authenticated user context not found"*.
- **Technical Explanation**: The API request was intercepted by the `requireAuth` middleware because the custom header was missing or the stored user ID did not match a record in the database.
- **Resolution Steps**:
  1. Inspect if the user's local session has expired or been corrupted in their browser's `localStorage` cache.
  2. Direct the user to **Log Out** and perform a fresh login to re-establish a valid session token.
  3. If the user was recently registered, query `GET /api/v1/users` (Admin only) to verify their identity record exists in the database.

### Scenario 7: 403 Forbidden Response (RBAC Guard Violation)
- **Problem**: User receives an error: *"Forbidden: Access denied. Action requires role: X"*.
- **Technical Explanation**: The authenticated user successfully resolved their identity but did not possess the required ecosystem role (e.g. a `buyer` attempting to call `POST /api/v1/products` or a `merchant` attempting to browse admin audit logs).
- **Resolution Steps**:
  1. Verify the user's role metadata using the Admin dashboard.
  2. If a merchant has mistakenly registered as a buyer (or vice versa), their role cannot be changed directly in the UI. An administrator must update their user record role attribute directly in the database.
  3. Direct the user to log in with an account that has the appropriate permissions for the requested view.
