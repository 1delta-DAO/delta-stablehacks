# KYC/KYB Backend Service

REST API for institutional onboarding. Approved wallets are written to the
`delta-mint` on-chain whitelist so they can interact with the permissioned
DeFi vault.

---

## Architecture

```
packages/backend/src/
├── index.ts                        ← Fastify app entry point + plugins
├── config.ts                       ← Env-var config
├── types.ts                        ← Shared TypeScript types
├── db/
│   └── store.ts                    ← KycStore interface + in-memory impl
├── services/
│   ├── kyc.service.ts              ← Business logic + KycProvider interface
│   └── blockchain.service.ts      ← Solana/Anchor whitelist calls
└── routes/
    └── kyc.routes.ts               ← Fastify route handlers
```

### Layer boundaries

| Layer            | File                     | Responsibility                        |
|------------------|--------------------------|---------------------------------------|
| **API**          | `routes/kyc.routes.ts`   | Parse HTTP, call service, map errors  |
| **KYC Service**  | `services/kyc.service.ts`| Business rules, state transitions     |
| **Blockchain**   | `services/blockchain.service.ts` | Solana PDAs, instruction building, tx |
| **DB**           | `db/store.ts`            | In-memory persistence (swappable)     |

---

## Setup

### 1. Prerequisites

- Node.js 20+, pnpm
- Solana CLI (`solana --version`)
- An Anchor program deployed — `delta-mint` at `3FLEACtqQ2G9h6sc7gLniVfK4maG59Eo4pt8H4A9QggY`

### 2. Generate keypairs (devnet)

```bash
# Admin authority — must match the keypair used to call initialize_mint
solana-keygen new --outfile admin-keypair.json
solana airdrop 2 $(solana-keygen pubkey admin-keypair.json) --url devnet

# Read the byte array for ADMIN_KEYPAIR_JSON
cat admin-keypair.json
```

### 3. Configure .env

```bash
cp packages/backend/.env.example packages/backend/.env
# Edit .env with your admin keypair bytes and wrapped mint address
```

### 4. Install & run

```bash
pnpm install
pnpm --filter backend dev     # hot-reload dev server on :3001
pnpm --filter backend test    # run unit tests (no Solana RPC needed)
```

---

## API Reference

### POST /kyc/submit

Submit a new KYC application. Wallet is stored with `status: pending`.

```bash
curl -X POST http://localhost:3001/kyc/submit \
  -H "Content-Type: application/json" \
  -d '{
    "walletAddress": "So11111111111111111111111111111111111111112",
    "entityType": "individual",
    "name": "Alice Smith",
    "email": "alice@example.com"
  }'
```

Response `201`:
```json
{
  "success": true,
  "data": {
    "walletAddress": "So11111111111111111111111111111111111111112",
    "entityType": "individual",
    "name": "Alice Smith",
    "email": "alice@example.com",
    "status": "pending",
    "createdAt": "2024-01-15T10:00:00.000Z",
    "updatedAt": "2024-01-15T10:00:00.000Z"
  }
}
```

---

### GET /kyc/status/:walletAddress

Check current KYC status.

```bash
curl http://localhost:3001/kyc/status/So11111111111111111111111111111111111111112
```

Response `200`:
```json
{
  "success": true,
  "data": {
    "walletAddress": "So11111111111111111111111111111111111111112",
    "status": "approved",
    "txSignature": "5J7xP...abc",
    ...
  }
}
```

---

### POST /kyc/approve

Approve a wallet. **Triggers an on-chain `add_to_whitelist` transaction** signed
by the admin keypair.

```bash
curl -X POST http://localhost:3001/kyc/approve \
  -H "Content-Type: application/json" \
  -d '{ "walletAddress": "So11111111111111111111111111111111111111112" }'
```

Response `200` — includes the Solana tx signature for audit:
```json
{
  "success": true,
  "data": {
    "status": "approved",
    "txSignature": "5J7xPMR...",
    ...
  }
}
```

---

### POST /kyc/reject

Reject a wallet. No on-chain transaction; status is updated in the DB.

```bash
curl -X POST http://localhost:3001/kyc/reject \
  -H "Content-Type: application/json" \
  -d '{ "walletAddress": "So11111111111111111111111111111111111111112" }'
```

---

### GET /kyc/list

List all KYC records (admin utility).

```bash
curl http://localhost:3001/kyc/list
```

---

### GET /health

```bash
curl http://localhost:3001/health
# { "status": "ok", "timestamp": "..." }
```

---

## On-chain Flow

When `/kyc/approve` is called:

1. Backend derives `mint_config` PDA: `["mint_config", wrappedMint]`
2. Backend derives `whitelist_entry` PDA: `["whitelist", mintConfig, wallet]`
3. Checks the entry doesn't already exist (duplicate guard)
4. Builds `add_to_whitelist` instruction with the admin keypair as signer
5. Sends and confirms transaction on devnet
6. Stores the tx signature in the KYC record

The `whitelist_entry` account is then checked on-chain by `delta-mint`'s
`mint_to` instruction before minting wrapped tokens.

---

## Replacing the Mock KYC Provider

See [PROVIDER_SWAP.md](./PROVIDER_SWAP.md) for step-by-step instructions on
integrating Persona, Jumio, Sumsub, or Onfido without touching the blockchain
layer.

---

## Security Notes

- The admin keypair **never leaves the backend**. Frontend users never sign whitelist transactions.
- Wallet address validation rejects malformed base58 before any DB writes.
- Duplicate whitelist entries are blocked both in the DB and on-chain.
- Rate limiting (30 req/min by default) is applied globally.
- In production: add auth middleware to `/kyc/approve`, `/kyc/reject`, `/kyc/list`.
