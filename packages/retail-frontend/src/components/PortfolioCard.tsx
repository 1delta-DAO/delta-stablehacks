import type { DeploymentConfig } from "../config/devnet";

interface PortfolioCardProps {
  usdcBalance: number | null;
  depositedUsdc: number;
  supplyAPY: number;
}

export function PortfolioCard({ usdcBalance, depositedUsdc, supplyAPY }: PortfolioCardProps) {
  const totalValue = (usdcBalance || 0) + depositedUsdc;
  const monthlyYield = depositedUsdc * supplyAPY / 12;

  return (
    <div style={styles.card}>
      <h3 style={styles.title}>Your Portfolio</h3>

      <div style={styles.row}>
        <span style={styles.label}>Wallet USDC</span>
        <span style={styles.value}>
          ${usdcBalance !== null ? usdcBalance.toLocaleString(undefined, { minimumFractionDigits: 2 }) : "—"}
        </span>
      </div>

      <div style={styles.row}>
        <span style={styles.label}>Deposited</span>
        <span style={styles.value}>
          ${depositedUsdc.toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </span>
      </div>

      <div style={{ ...styles.row, borderTop: "1px solid #1f2937", paddingTop: 12, marginTop: 4 }}>
        <span style={{ ...styles.label, color: "#fff", fontWeight: 600 }}>Total</span>
        <span style={{ ...styles.value, color: "#fff", fontWeight: 700 }}>
          ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </span>
      </div>

      {depositedUsdc > 0 && (
        <div style={styles.yieldBox}>
          <span style={styles.yieldLabel}>Est. monthly yield ({(supplyAPY * 100).toFixed(1)}% APY)</span>
          <span style={styles.yieldValue}>+${monthlyYield.toFixed(2)}</span>
        </div>
      )}

      <div style={styles.statusRow}>
        <span style={styles.statusDot} />
        <span style={styles.statusText}>KYC Verified</span>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: { background: "#111827", border: "1px solid #1f2937", borderRadius: 12, padding: "24px" },
  title: { fontSize: 16, fontWeight: 700, color: "#fff", marginBottom: 20 },
  row: { display: "flex", justifyContent: "space-between", marginBottom: 12 },
  label: { fontSize: 14, color: "#9ca3af" },
  value: { fontSize: 14, color: "#d1d5db", fontFamily: "monospace" },
  yieldBox: { background: "#0d2818", border: "1px solid #166534", borderRadius: 8, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 },
  yieldLabel: { fontSize: 12, color: "#4ade80" },
  yieldValue: { fontSize: 16, fontWeight: 700, color: "#4ade80" },
  statusRow: { display: "flex", alignItems: "center", gap: 8, marginTop: 20, paddingTop: 12, borderTop: "1px solid #1f2937" },
  statusDot: { width: 8, height: 8, borderRadius: "50%", background: "#4ade80" },
  statusText: { fontSize: 12, color: "#4ade80" },
};
