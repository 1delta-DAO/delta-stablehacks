import { useState, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import {
  Transaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import type { DeploymentConfig } from "../config/devnet";
import {
  buildDepositReserveLiquidityIx,
  buildRefreshReserveIx,
  reserveCollateralMint,
} from "../lib/klend";

interface DepositCardProps {
  usdcBalance: number | null;
  config: DeploymentConfig;
  supplyAPY?: number;
  onSuccess?: () => void;
}

export function DepositCard({ usdcBalance, config, supplyAPY = 0, onSuccess }: DepositCardProps) {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<"idle" | "depositing" | "success" | "error">("idle");
  const [txSig, setTxSig] = useState<string>("");
  const [error, setError] = useState<string>("");

  const maxAmount = usdcBalance || 0;
  const apyPct = (supplyAPY * 100).toFixed(2);

  const handleDeposit = useCallback(async () => {
    if (!publicKey || !amount || Number(amount) <= 0) return;
    setStatus("depositing");
    setError("");

    try {
      const reserve = config.market.usdcReserve;
      const market = config.market.lendingMarket;
      const usdcMint = config.usdc.mint;
      const oracle = config.market.usdcOracle;

      const amountNative = BigInt(Math.floor(Number(amount) * 1e6));

      // User ATAs
      const userUsdcAta = getAssociatedTokenAddressSync(
        usdcMint, publicKey, false, TOKEN_PROGRAM_ID
      );
      const cMint = reserveCollateralMint(reserve);
      const userCTokenAta = getAssociatedTokenAddressSync(
        cMint, publicKey, false, TOKEN_PROGRAM_ID
      );

      const tx = new Transaction();
      tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));

      // Create cToken ATA if it doesn't exist
      const cTokenInfo = await connection.getAccountInfo(userCTokenAta);
      if (!cTokenInfo) {
        tx.add(
          createAssociatedTokenAccountInstruction(
            publicKey, userCTokenAta, publicKey, cMint, TOKEN_PROGRAM_ID
          )
        );
      }

      // RefreshReserve must precede deposit in the same transaction (check_refresh)
      tx.add(
        buildRefreshReserveIx(reserve, market, oracle)
      );

      // Deposit
      tx.add(
        buildDepositReserveLiquidityIx(
          publicKey,
          reserve,
          market,
          usdcMint,
          amountNative,
          TOKEN_PROGRAM_ID,
          TOKEN_PROGRAM_ID,
          userUsdcAta,
          userCTokenAta,
        )
      );

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;

      const signed = await signTransaction!(tx);
      const sig = await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");

      setTxSig(sig);
      setStatus("success");
      setAmount("");
      onSuccess?.();
    } catch (e: any) {
      console.error("Deposit failed:", e);
      setError(e.message?.slice(0, 120) || "Deposit failed");
      setStatus("error");
    }
  }, [publicKey, amount, connection, config, signTransaction]);

  const isDisabled = status === "depositing" || Number(amount) <= 0 || Number(amount) > maxAmount;

  return (
    <div className="card bg-base-200 border border-base-300 shadow-xl">
      <div className="card-body p-6 gap-4">
        <h3 className="card-title text-lg">Deposit USDC</h3>
        <p className="text-sm opacity-50 mb-5">
          Earn {apyPct}% APY by supplying USDC to the lending market
        </p>

        <div className="mb-4">
          <label className="block text-xs uppercase tracking-wide opacity-60 mb-1.5">
            Amount (USDC)
          </label>
          <div className="flex gap-2">
            <input
              type="number"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setStatus("idle"); }}
              placeholder="0.00"
              min="0"
              max={maxAmount}
              step="0.01"
              className="input input-bordered bg-base-200 text-base-content w-full font-mono text-lg"
            />
            <button
              onClick={() => setAmount(String(maxAmount))}
              className="btn btn-ghost btn-sm border border-base-300 text-primary font-bold self-center"
            >
              MAX
            </button>
          </div>
          <span className="block text-xs opacity-50 mt-1.5 text-right">
            Balance: {maxAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })} USDC
          </span>
        </div>

        {Number(amount) > 0 && (
          <div className="bg-base-300 rounded-lg p-3 mb-4">
            <div className="flex justify-between text-sm opacity-80 mb-1">
              <span>You deposit</span>
              <span>${Number(amount).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="opacity-80">Est. yearly yield ({apyPct}%)</span>
              <span className="text-success font-semibold">
                +${(Number(amount) * supplyAPY).toFixed(2)}
              </span>
            </div>
          </div>
        )}

        <button
          onClick={handleDeposit}
          disabled={isDisabled}
          className={`btn btn-primary w-full text-base ${isDisabled ? "btn-disabled opacity-50" : ""}`}
        >
          {status === "depositing" ? "Depositing..." : status === "success" ? "Deposited!" : "Deposit USDC"}
        </button>

        {status === "success" && txSig && (
          <p className="text-success text-sm mt-3 text-center">
            Deposit confirmed!{" "}
            <a
              href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
              className="link link-success"
            >
              View tx
            </a>
          </p>
        )}
        {error && <p className="text-error text-xs mt-2">{error}</p>}

        <div className="mt-5 pt-4 border-t border-base-300 text-xs opacity-50 leading-relaxed">
          <p>No lock-up period — withdraw anytime</p>
          <p>Interest accrues every Solana slot (~400ms)</p>
        </div>
      </div>
    </div>
  );
}
