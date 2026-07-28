# AURA | Fluid E-Commerce Marketplace

AURA is a high-fidelity, ultra-premium marketplace application prototype featuring an interactive split-view system: a consumer storefront, merchant portal, and real-time backend ledger simulator.

This repository runs a versioned REST API on Express, incorporating database principles like ACID transactional queues, optimistic concurrency locking, soft deletes, and structured audit logs.

---

## Technical Architecture Overview

- **Versioned API Gateway (`/api/v1`)**: Version-isolated HTTP routing.
- **ACID Database Grid**: Memory-mapped data store with transaction rollback queues.
- **Optimistic Locking**: Product catalog updates verify expected versions to prevent double-allocation during high-frequency checkouts.
- **Universal Error Handler (`AppError`)**: Gracefully catches operational errors (balance checks, version conflicts) and formats response messages.
- **Audit Trails**: Appends all database state mutations to a secure log table, capturing timestamps, actor IDs, actions, and system data states.
- **Split Environment Configurations**: Load configurations from `.env.development` or `.env.production` depending on `NODE_ENV`.
- **Integrated Policy Viewer**: Dynamically reads and renders drafted legal documents:
  - **TOS** (Terms of Service)
  - **Privacy Policy**
  - **DPA** (Data Processing Agreement)
  - **Refund Policy**
  - **MSA** (Master Service Agreement)

---

## File Structure

```
fluid-marketplace/
├── .env.development      # Development environment variables
├── .env.production       # Production environment variables
├── .gitignore            # Git exclusion rules
├── package.json          # Node dependencies (Express, CORS, dotenv, etc.)
├── README.md             # Repository documentation
├── support_playbook.md   # Troubleshooting & Support Manual
├── legal/                # Drafted legal agreements
│   ├── TOS.md            
│   ├── PRIVACY.md        
│   ├── DPA.md            
│   ├── REFUND.md         
│   └── MSA.md            
├── server/               # Backend API server
│   ├── server.js         # Entrypoint
│   ├── config.js         # Config Loader
│   ├── errors.js         # AppError and ErrorHandler middleware
│   ├── database.js       # Transactional Mock DB
│   ├── audit.js          # Audit Trail Logging
│   └── routes/
│       └── api_v1.js     # Versioned endpoints
└── public/               # Frontend Client (Sleek Glassmorphic SPA)
    ├── index.html        
    ├── styles.css        
    └── app.js            
```

---

## Local Setup & Installation

### 1. Install Dependencies
Run the package installation command:
```bash
npm install
```

### 2. Run the Server
Launch the server in development mode:
```bash
npm run dev
```

The application will start, outputting:
```
================================================================
 AURA Marketplace Core API Running in [development] Mode
 Port: 8082 | API Version: /api/v1
 Local Sandbox URL: http://localhost:8082
================================================================
```

### 3. Open in Browser
Open your browser and navigate to `http://localhost:8082` to view the storefront dashboard.
- Use the **Persona dropdown** at the top right to switch between **Buyer** and **Merchant** modes.
- Explore the **AURA Architecture Ledger** at the bottom to watch raw API requests and database logs process in real time!
