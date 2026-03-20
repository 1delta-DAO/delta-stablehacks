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
}

export function WithdrawCard({
  depositedUsdc,
  cTokenBalance,
  exchangeRate,
  config,
}: WithdrawCardProps) {
  const { publicKey, sendTransaction } = useWallet();
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

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");

      setTxSig(sig);
      setStatus("success");
      setAmount("");
    } catch (e: any) {
      console.error("Withdraw failed:", e);
      setError(e.message?.slice(0, 120) || "Withdrawal failed");
      setStatus("error");
    }
  }, [publicKey, amount, connection, config, exchangeRate, sendTransaction]);

  if (depositedUsdc <= 0) return null;

  return (
    <div style={styles.card}>
      <h3 style={styles.title}>Withdraw USDC</h3>
      <p style={styles.subtitle}>Redeem your deposit + earned interest</p>

      <div style={styles.inputGroup}>
        <label style={styles.label}>Amount (USDC)</label>
        <div style={styles.inputRow}>
          <input
            type="number"
            value={amount}
            onChange={(e) => { setAmount(e.target.value); setStatus("idle"); }}
            placeholder="0.00"
            min="0"
            max={maxUsdc}
            step="0.01"
            style={styles.input}
          />
          <button onClick={() => setAmount(String(maxUsdc.toFixed(2)))} style={styles.maxBtn}>
            MAX
          </button>
        </div>
        <span style={styles.balanceHint}>
          Available: {maxUsdc.toLocaleString(undefined, { minimumFractionDigits: 2 })} USDC
        </span>
      </div>

      <button
        onClick={handleWithdraw}
        disabled={status === "withdrawing" || Number(amount) <= 0 || Number(amount) > maxUsdc}
        style={{
          ...styles.withdrawBtn,
          opacity: status === "withdrawing" || Number(amount) <= 0 || Number(amount) > maxUsdc ? 0.5 : 1,
        }}
      >
        {status === "withdrawing" ? "Withdrawing..." : status === "success" ? "Withdrawn!" : "Withdraw USDC"}
      </button>

      {status === "success" && txSig && (
        <p style={styles.success}>
          Withdrawal confirmed!{" "}
          <a href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`} target="_blank" rel="noreferrer" style={{ color: "#4ade80" }}>
            View tx
          </a>
        </p>
      )}
      {error && <p style={styles.error}>{error}</p>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: { background: "#111827", border: "1px solid #1f2937", borderRadius: 12, padding: "24px" },
  title: { fontSize: 16, fontWeight: 700, color: "#fff", marginBottom: 4 },
  subtitle: { fontSize: 13, color: "#6b7280", marginBottom: 20 },
  inputGroup: { marginBottom: 16 },
  label: { display: "block", fontSize: 12, color: "#9ca3af", marginBottom: 6, textTransform: "uppercase" as const, letterSpacing: 0.5 },
  inputRow: { display: "flex", gap: 8 },
  input: { flex: 1, background: "#0a0e17", border: "1px solid #1f2937", borderRadius: 8, padding: "12px 16px", color: "#fff", fontSize: 18, fontFamily: "monospace", outline: "none" },
  maxBtn: { background: "#1f2937", border: "1px solid #374151", borderRadius: 8, padding: "0 16px", color: "#4ecdc4", fontSize: 12, fontWeight: 700, cursor: "pointer" },
  balanceHint: { display: "block", fontSize: 11, color: "#6b7280", marginTop: 6, textAlign: "right" as const },
  withdrawBtn: { width: "100%", background: "#374151", color: "#fff", border: "1px solid #4b5563", borderRadius: 8, padding: "14px", fontSize: 15, fontWeight: 700, cursor: "pointer" },
  success: { color: "#4ade80", fontSize: 13, marginTop: 12, textAlign: "center" as const },
  error: { color: "#ef4444", fontSize: 12, marginTop: 8 },
};
