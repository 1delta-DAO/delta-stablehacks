import { useState, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { Transaction, ComputeBudgetProgram } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { DeploymentConfig } from "../config/devnet";
import {
  buildRefreshReserveIx,
  buildRedeemReserveCollateralIx,
  reserveCollateralMint,
} from "../lib/klend";

interface WithdrawCardProps {
  depositedUsdc: number;
  cTokenBalance: number;
  exchangeRate: number;
  config: DeploymentConfig;
  onSuccess?: () => void;
}

export function WithdrawCard({
  depositedUsdc,
  cTokenBalance,
  exchangeRate,
  config,
  onSuccess,
}: WithdrawCardProps) {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<"idle" | "withdrawing" | "success" | "error">("idle");
  const [txSig, setTxSig] = useState("");
  const [error, setError] = useState("");

  const maxUsdc = depositedUsdc;

  const handleWithdraw = useCallback(async () => {
    if (!publicKey || !amount || Number(amount) <= 0) return;
    setStatus("withdrawing");
    setError("");

    try {
      const reserve = config.market.usdcReserve;
      const market = config.market.lendingMarket;
      const usdcMint = config.usdc.mint;
      const oracle = config.market.usdcOracle;

      // Convert USDC amount to cToken amount
      const usdcNative = Number(amount) * 1e6;
      const cTokenAmount = exchangeRate > 0
        ? BigInt(Math.floor(usdcNative / exchangeRate))
        : BigInt(Math.floor(usdcNative));

      const cMint = reserveCollateralMint(reserve);
      const userCTokenAta = getAssociatedTokenAddressSync(cMint, publicKey, false, TOKEN_PROGRAM_ID);
      const userUsdcAta = getAssociatedTokenAddressSync(usdcMint, publicKey, false, TOKEN_PROGRAM_ID);

      const tx = new Transaction();
      tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
      tx.add(buildRefreshReserveIx(reserve, market, oracle));
      tx.add(
        buildRedeemReserveCollateralIx(
          publicKey,
          reserve,
          market,
          usdcMint,
          cTokenAmount,
          TOKEN_PROGRAM_ID,
          TOKEN_PROGRAM_ID,
          userCTokenAta,
          userUsdcAta,
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
      console.error("Withdraw failed:", e);
      setError(e.message?.slice(0, 120) || "Withdrawal failed");
      setStatus("error");
    }
  }, [publicKey, amount, connection, config, exchangeRate, signTransaction]);

  if (depositedUsdc <= 0) return null;

  const isDisabled = status === "withdrawing" || Number(amount) <= 0 || Number(amount) > maxUsdc;

  return (
    <div className="card bg-base-200 border border-base-300 shadow-xl">
      <div className="card-body p-6 gap-4">
        <h3 className="card-title text-lg">Withdraw USDC</h3>
        <p className="text-sm opacity-50 mb-5">Redeem your deposit + earned interest</p>

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
              max={maxUsdc}
              step="0.01"
              className="input input-bordered bg-base-200 text-base-content w-full font-mono text-lg"
            />
            <button
              onClick={() => setAmount(String(maxUsdc.toFixed(2)))}
              className="btn btn-ghost btn-sm border border-base-300 text-primary font-bold self-center"
            >
              MAX
            </button>
          </div>
          <span className="block text-xs opacity-50 mt-1.5 text-right">
            Available: {maxUsdc.toLocaleString(undefined, { minimumFractionDigits: 2 })} USDC
          </span>
        </div>

        <button
          onClick={handleWithdraw}
          disabled={isDisabled}
          className={`btn btn-warning w-full text-base ${isDisabled ? "btn-disabled opacity-50" : ""}`}
        >
          {status === "withdrawing" ? "Withdrawing..." : status === "success" ? "Withdrawn!" : "Withdraw USDC"}
        </button>

        {status === "success" && txSig && (
          <p className="text-success text-sm mt-3 text-center">
            Withdrawal confirmed!{" "}
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
      </div>
    </div>
  );
}
