interface PortfolioCardProps {
  usdcBalance: number | null;
  depositedUsdc: number;
  supplyAPY: number;
}

export function PortfolioCard({ usdcBalance, depositedUsdc, supplyAPY }: PortfolioCardProps) {
  const totalValue = (usdcBalance || 0) + depositedUsdc;
  const monthlyYield = depositedUsdc * supplyAPY / 12;

  return (
    <div className="card bg-base-200 border border-base-300 shadow-xl">
      <div className="card-body p-6 gap-4">
        <h3 className="card-title text-lg mb-5">Your Portfolio</h3>

        <div className="flex justify-between mb-3">
          <span className="text-sm opacity-60">Wallet USDC</span>
          <span className="text-sm font-mono">
            ${usdcBalance !== null ? usdcBalance.toLocaleString(undefined, { minimumFractionDigits: 2 }) : "\u2014"}
          </span>
        </div>

        <div className="flex justify-between mb-3">
          <span className="text-sm opacity-60">Deposited</span>
          <span className="text-sm font-mono">
            ${depositedUsdc.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </span>
        </div>

        <div className="flex justify-between border-t border-base-300 pt-3 mt-1">
          <span className="text-sm font-semibold">Total</span>
          <span className="text-sm font-mono font-bold">
            ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </span>
        </div>

        {depositedUsdc > 0 && (
          <div className="alert alert-success mt-4 flex justify-between items-center">
            <span className="text-xs text-success">
              Est. monthly yield ({(supplyAPY * 100).toFixed(1)}% APY)
            </span>
            <span className="text-base font-bold text-success">
              +${monthlyYield.toFixed(2)}
            </span>
          </div>
        )}

        <div className="flex items-center gap-2 mt-5 pt-3 border-t border-base-300">
          <span className="w-2 h-2 rounded-full bg-success" />
          <span className="text-xs text-success">KYC Verified</span>
        </div>
      </div>
    </div>
  );
}
