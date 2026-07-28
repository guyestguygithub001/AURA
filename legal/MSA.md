# MASTER SERVICE AGREEMENT (MSA)

**Last Updated: July 28, 2026**

This Master Service Agreement ("MSA") is entered into by and between AURA ("Platform Provider") and the Merchant ("Service Provider" or "Vendor") registering an account.

---

## 1. Uptime SLA & Performance Targets
- **Availability Target**: AURA targets a **99.9% platform availability** (excluding scheduled maintenance).
- **Latency SLAs**: API response times (for search and transaction processing) are monitored continuously to keep 95th-percentile response latency below **100ms**.

## 2. Platform Commissions & Fees
- AURA charges a **5% transaction commission fee** on all completed sales processed through the platform.
- Fees are automatically deducted by the Payment Gateway prior to clearing the escrow balance.

## 3. Escrow Management & Payouts
- Funds are disbursed directly to the Merchant’s designated bank account via Stripe Connect.
- Disbursements are executed on a rolling schedule (e.g., T+2 days) after escrow release conditions are met.

## 4. Indemnification & Liability
- The Merchant agrees to indemnify and hold AURA harmless against any claims, losses, or costs arising from defective products, IP infringement, or tax compliance failure.

## 5. Security & Audits
- Both parties must comply with PCI-DSS guidelines.
- AURA reserves the right to run periodic automated inventory audit scripts and code scanning to protect API security.
