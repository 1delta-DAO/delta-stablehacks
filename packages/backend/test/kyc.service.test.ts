import { describe, it, expect, beforeEach } from "vitest";
import { KycService, ValidationError, NotFoundError, ConflictError } from "../src/services/kyc.service.js";
import { createKycStore } from "../src/db/store.js";
import { setBlockchainService } from "../src/services/blockchain.service.js";
import type { BlockchainService } from "../src/services/blockchain.service.js";

// ---------------------------------------------------------------------------
// Mock blockchain service — no Solana RPC calls
// ---------------------------------------------------------------------------

const mockBlockchain: BlockchainService = {
  validateAddress: (addr) => addr.length >= 32 && addr.length <= 44,
  isWhitelisted: async () => false,
  addToWhitelist: async (addr) => [
    { mintAddress: "mockMintA", signature: `mocksig_${addr.slice(0, 8)}`, whitelistEntryAddress: `mockpda_${addr.slice(0, 8)}` },
    { mintAddress: "mockMintB", signature: `mocksig2_${addr.slice(0, 8)}`, whitelistEntryAddress: `mockpda2_${addr.slice(0, 8)}` },
  ],
  removeFromWhitelist: async (addr) => [`mockremovesig_${addr.slice(0, 8)}`],
};

const VALID_WALLET = "So11111111111111111111111111111111111111112";
const VALID_WALLET_2 = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// ---------------------------------------------------------------------------

describe("KycService", () => {
  let svc: KycService;

  beforeEach(() => {
    setBlockchainService(mockBlockchain);
    svc = new KycService(createKycStore());
  });

  describe("submitKyc", () => {
    it("creates a pending record", async () => {
      const record = await svc.submitKyc({
        walletAddress: VALID_WALLET,
        entityType: "individual",
        name: "Alice",
        email: "alice@example.com",
      });
      expect(record.status).toBe("pending");
      expect(record.walletAddress).toBe(VALID_WALLET);
    });

    it("rejects duplicate submissions", async () => {
      const body = { walletAddress: VALID_WALLET, entityType: "individual" as const, name: "Alice", email: "alice@example.com" };
      await svc.submitKyc(body);
      await expect(svc.submitKyc(body)).rejects.toBeInstanceOf(ConflictError);
    });

    it("rejects invalid wallet address", async () => {
      await expect(svc.submitKyc({
        walletAddress: "not-a-valid-address!!",
        entityType: "individual",
        name: "Bob",
        email: "bob@example.com",
      })).rejects.toBeInstanceOf(ValidationError);
    });

    it("rejects missing name", async () => {
      await expect(svc.submitKyc({
        walletAddress: VALID_WALLET,
        entityType: "individual",
        name: "",
        email: "test@example.com",
      })).rejects.toBeInstanceOf(ValidationError);
    });

    it("rejects invalid email", async () => {
      await expect(svc.submitKyc({
        walletAddress: VALID_WALLET,
        entityType: "individual",
        name: "Alice",
        email: "not-an-email",
      })).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe("getStatus", () => {
    it("returns the record after submission", async () => {
      await svc.submitKyc({ walletAddress: VALID_WALLET, entityType: "individual", name: "Alice", email: "a@b.com" });
      const record = svc.getStatus(VALID_WALLET);
      expect(record.status).toBe("pending");
    });

    it("throws NotFoundError for unknown wallet", () => {
      expect(() => svc.getStatus(VALID_WALLET)).toThrow(NotFoundError);
    });
  });

  describe("approveWallet", () => {
    it("transitions to approved and stores tx signature", async () => {
      await svc.submitKyc({ walletAddress: VALID_WALLET, entityType: "company", name: "Acme Corp", email: "kyc@acme.com" });
      const record = await svc.approveWallet(VALID_WALLET);
      expect(record.status).toBe("approved");
      expect(record.whitelistResults?.[0].signature).toMatch(/^mocksig_/);
    });

    it("throws ConflictError if already approved", async () => {
      await svc.submitKyc({ walletAddress: VALID_WALLET, entityType: "individual", name: "Alice", email: "a@b.com" });
      await svc.approveWallet(VALID_WALLET);
      await expect(svc.approveWallet(VALID_WALLET)).rejects.toBeInstanceOf(ConflictError);
    });

    it("throws NotFoundError for unknown wallet", async () => {
      await expect(svc.approveWallet(VALID_WALLET)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("rejectWallet", () => {
    it("transitions to rejected", async () => {
      await svc.submitKyc({ walletAddress: VALID_WALLET, entityType: "individual", name: "Alice", email: "a@b.com" });
      const record = await svc.rejectWallet(VALID_WALLET);
      expect(record.status).toBe("rejected");
    });

    it("throws ConflictError if already rejected", async () => {
      await svc.submitKyc({ walletAddress: VALID_WALLET, entityType: "individual", name: "Alice", email: "a@b.com" });
      await svc.rejectWallet(VALID_WALLET);
      await expect(svc.rejectWallet(VALID_WALLET)).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe("listAll", () => {
    it("returns all records", async () => {
      await svc.submitKyc({ walletAddress: VALID_WALLET, entityType: "individual", name: "Alice", email: "a@b.com" });
      await svc.submitKyc({ walletAddress: VALID_WALLET_2, entityType: "company", name: "Acme", email: "kyc@acme.com" });
      expect(svc.listAll()).toHaveLength(2);
    });
  });
});
