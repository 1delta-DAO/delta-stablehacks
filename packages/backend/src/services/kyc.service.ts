/**
 * KYC Service — pure business logic, no Express/Fastify dependencies.
 *
 * This is the layer you replace when plugging in a real KYC provider
 * (Persona, Jumio, Sumsub). See PROVIDER_SWAP.md for details.
 *
 * Current implementation: manual approval flow (mock / admin-driven).
 * Production flow: webhook from provider → call approveWallet() internally.
 */

import type { KycRecord, KycStatus, SubmitKycBody } from "../types.js";
import type { KycStore } from "../db/store.js";
import { createKycStore } from "../db/store.js";
import { getBlockchainService } from "./blockchain.service.js";

// ---------------------------------------------------------------------------
// KYC Provider interface
// ---------------------------------------------------------------------------

/**
 * Implement this interface to swap in a real KYC provider.
 *
 * Example Persona webhook flow:
 *   1. POST /kyc/submit  → createInquiry(record) → returns inquiry ID
 *   2. User completes verification on Persona hosted flow
 *   3. Persona POSTs webhook to /kyc/webhook/persona
 *   4. Webhook handler calls provider.handleWebhook(payload)
 *   5. Provider resolves → calls kycService.approveWallet(walletAddress)
 */
export interface KycProvider {
  /** Called when a new KYC submission is received. */
  onSubmit(record: KycRecord): Promise<void>;
  /** Called when an admin manually approves (mock only, no-op in real providers). */
  onApprove(record: KycRecord): Promise<void>;
  /** Called when an admin manually rejects. */
  onReject(record: KycRecord): Promise<void>;
}

class MockKycProvider implements KycProvider {
  async onSubmit(record: KycRecord): Promise<void> {
    console.log(`[kyc:mock] New submission from ${record.walletAddress} (${record.entityType})`);
  }
  async onApprove(record: KycRecord): Promise<void> {
    console.log(`[kyc:mock] Approved ${record.walletAddress}`);
  }
  async onReject(record: KycRecord): Promise<void> {
    console.log(`[kyc:mock] Rejected ${record.walletAddress}`);
  }
}

// ---------------------------------------------------------------------------
// KYC Service
// ---------------------------------------------------------------------------

export class KycService {
  private readonly store: KycStore;
  private readonly blockchain = getBlockchainService();
  private provider: KycProvider;

  constructor(store?: KycStore, provider?: KycProvider) {
    this.store = store ?? createKycStore();
    this.provider = provider ?? new MockKycProvider();
  }

  /** Swap the KYC provider at runtime (e.g., for testing or feature flags). */
  setProvider(provider: KycProvider): void {
    this.provider = provider;
  }

  // -------------------------------------------------------------------------
  // Submit
  // -------------------------------------------------------------------------

  async submitKyc(body: SubmitKycBody): Promise<KycRecord> {
    if (!this.blockchain.validateAddress(body.walletAddress)) {
      throw new ValidationError("Invalid Solana wallet address");
    }

    const existing = this.store.findByWallet(body.walletAddress);
    if (existing) {
      throw new ConflictError(
        `KYC already submitted for ${body.walletAddress} (status: ${existing.status})`
      );
    }

    if (!["individual", "company"].includes(body.entityType)) {
      throw new ValidationError('entityType must be "individual" or "company"');
    }

    if (!body.name?.trim()) throw new ValidationError("name is required");
    if (!body.email?.trim()) throw new ValidationError("email is required");
    if (!isValidEmail(body.email)) throw new ValidationError("Invalid email address");

    const record = this.store.create({
      walletAddress: body.walletAddress,
      entityType: body.entityType,
      name: body.name.trim(),
      email: body.email.trim().toLowerCase(),
      status: "pending",
    });

    await this.provider.onSubmit(record);
    return record;
  }

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  getStatus(walletAddress: string): KycRecord {
    const record = this.store.findByWallet(walletAddress);
    if (!record) throw new NotFoundError(`No KYC record for ${walletAddress}`);
    return record;
  }

  // -------------------------------------------------------------------------
  // Approve — triggers on-chain whitelist write
  // -------------------------------------------------------------------------

  async approveWallet(walletAddress: string): Promise<KycRecord> {
    const record = this.store.findByWallet(walletAddress);
    if (!record) throw new NotFoundError(`No KYC record for ${walletAddress}`);
    if (record.status === "approved") {
      throw new ConflictError(`${walletAddress} is already approved`);
    }

    // Write to on-chain whitelist for every configured pool
    const whitelistResults = await this.blockchain.addToWhitelist(walletAddress);

    const updated = this.store.updateStatus(walletAddress, "approved", whitelistResults)!;
    await this.provider.onApprove(updated);

    const sigs = whitelistResults.map((r) => r.signature).join(", ");
    console.log(`[kyc] Approved ${walletAddress} | txs: ${sigs}`);
    return updated;
  }

  // -------------------------------------------------------------------------
  // Reject
  // -------------------------------------------------------------------------

  async rejectWallet(walletAddress: string): Promise<KycRecord> {
    const record = this.store.findByWallet(walletAddress);
    if (!record) throw new NotFoundError(`No KYC record for ${walletAddress}`);
    if (record.status === "rejected") {
      throw new ConflictError(`${walletAddress} is already rejected`);
    }

    const updated = this.store.updateStatus(walletAddress, "rejected")!;
    await this.provider.onReject(updated);
    return updated;
  }

  // -------------------------------------------------------------------------
  // Admin helpers
  // -------------------------------------------------------------------------

  listAll(): KycRecord[] {
    return this.store.findAll();
  }
}

// ---------------------------------------------------------------------------
// Domain errors
// ---------------------------------------------------------------------------

export class ValidationError extends Error {
  readonly statusCode = 400;
  constructor(message: string) { super(message); this.name = "ValidationError"; }
}

export class NotFoundError extends Error {
  readonly statusCode = 404;
  constructor(message: string) { super(message); this.name = "NotFoundError"; }
}

export class ConflictError extends Error {
  readonly statusCode = 409;
  constructor(message: string) { super(message); this.name = "ConflictError"; }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: KycService | undefined;

export function getKycService(): KycService {
  if (!_instance) _instance = new KycService();
  return _instance;
}
