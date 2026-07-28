# AURA Marketplace

AURA is a high-fidelity lifestyle catalog prototype. It features a consumer storefront, merchant dashboard, admin console.

The platform demonstrates modern system architecture. It models strict backend workflows.

## Key Architectural Features

- **API Isolation**: All endpoints start with `/api/v1`.
- **ACID Transactions**: Memory modifications run sequentially. Operations commit successfully. Failed tasks trigger immediate state rollbacks.
- **Optimistic Locking**: Product catalog updates check expected version counters. Race conditions trigger transaction aborts.
- **Soft Deletes**: Deleting products updates a `deleted_at` timestamp. Historical records remain fully intact.
- **Audit Logging**: Every mutation appends record metrics. Logs detail actor IDs, timestamps, client IPs, state changes.
- **Environment Separation**: Settings load dynamically from `.env.development`, `.env.production`.
- **Dynamic Policies**: The frontend loads legal files directly from the server storage.

## Project File Structure

```
fluid-marketplace/
├── package.json
├── README.md
├── support_playbook.md
├── legal/
│   ├── TOS.md
│   ├── PRIVACY.md
│   ├── DPA.md
│   ├── REFUND.md
│   └── MSA.md
├── server/
│   ├── server.js
│   ├── config.js
│   ├── errors.js
│   ├── database.js
│   ├── audit.js
│   └── routes/
│       └── api_v1.js
└── public/
    ├── index.html
    ├── styles.css
    └── app.js
```

## Local Setup Instructions

### 1. Install Dependencies
Execute the package installer command:
```bash
npm install
```

### 2. Launch Local Server
Start the system listener:
```bash
npm run dev
```

The backend launches on port 8085.

### 3. Open Storefront
Navigate your web browser to:
`http://localhost:8085`

Select Buyer, Merchant, Admin personas via the selector menu. Switch themes using the nav buttons. Inspect system queries inside the ledger console.
