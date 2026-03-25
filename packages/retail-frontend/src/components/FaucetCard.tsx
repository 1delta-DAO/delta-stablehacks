import { useState, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { DEVNET_CONFIG } from "../config/devnet";

const FAUCET_API = import.meta.env.VITE_FAUCET_URL || "http://localhost:3099";

interface Props {
  usdcBalance: number | null;
  onMinted: () => void;
}

export function FaucetCard({ usdcBalance, onMinted }: Props) {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [status, setStatus] = useState<"idle" | "minting" | "success" | "error">("idle");
  const [error, setError] = useState("");

  const requestUsdc = useCallback(async () => {
    if (!publicKey) return;
    setStatus("minting");
    setError("");

    try {
      // First ensure the ATA exists (user pays for creation)
      const mint = DEVNET_CONFIG.usdc.mint;
      const ata = getAssociatedTokenAddressSync(mint, publicKey, false, TOKEN_PROGRAM_ID);

      const ataInfo = await connection.getAccountInfo(ata);
      if (!ataInfo) {
        const tx = new Transaction().add(
          createAssociatedTokenAccountInstruction(
            publicKey, ata, publicKey, mint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
          )
        );
        const sig = await sendTransaction(tx, connection);
        await connection.confirmTransaction(sig, "confirmed");
      }

      // Call faucet API
      const res = await fetch(`${FAUCET_API}/faucet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: publicKey.toBase58(), amount: 1000 }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `Faucet error ${res.status}`);
      }

      setStatus("success");
      setTimeout(() => { setStatus("idle"); onMinted(); }, 2000);
    } catch (e: any) {
      setError(e.message?.slice(0, 120) || "Failed");
      setStatus("error");
    }
  }, [publicKey, connection, sendTransaction, onMinted]);

  if (!publicKey) return null;

  const hasEnough = (usdcBalance ?? 0) >= 10;

  return (
    <div className="card bg-base-200 border border-base-300 shadow-xl">
      <div className="card-body p-6 gap-4">
        <h3 className="card-title text-lg">Test USDC Faucet</h3>
        <p className="text-sm opacity-50 mb-4">
          Get free test USDC to try depositing. Devnet only.
        </p>

        <div className="flex items-center gap-3">
          <div className="text-sm opacity-70">
            Balance:{" "}
            <span className="text-base-content font-semibold">
              {usdcBalance !== null ? `${usdcBalance.toFixed(2)} USDC` : "\u2014"}
            </span>
          </div>

          <button
            onClick={requestUsdc}
            disabled={status === "minting" || hasEnough}
            className={`btn ml-auto ${hasEnough ? "btn-disabled opacity-40" : "btn-primary"}`}
          >
            {status === "minting" ? "Minting..." :
             status === "success" ? "Done!" :
             hasEnough ? "Funded" :
             "Get 1,000 USDC"}
          </button>
        </div>

        {status === "error" && (
          <div className="text-error text-xs mt-2">
            {error || "Failed to mint. Is the faucet server running? (pnpm faucet:serve)"}
          </div>
        )}
      </div>
    </div>
  );
}
