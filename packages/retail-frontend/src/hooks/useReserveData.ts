import { useState, useEffect } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { DEVNET_CONFIG } from "../config/devnet";
import { decodeReserveInfo, reserveCollateralMint, type ReserveInfo } from "../lib/klend";

export interface ReserveData {
  supplyAPY: number;
  exchangeRate: number;
  cTokenMint: string;
  totalDeposited: number;
  utilization: number;
  loading: boolean;
}

export function useReserveData(): ReserveData {
  const { connection } = useConnection();
  const [data, setData] = useState<ReserveData>({
    supplyAPY: 0,
    exchangeRate: 1,
    cTokenMint: "",
    totalDeposited: 0,
    utilization: 0,
    loading: true,
  });

  useEffect(() => {
    const reserve = DEVNET_CONFIG.market.usdcReserve;
    const cMint = reserveCollateralMint(reserve);

    const fetch = async () => {
      try {
        const info = await connection.getAccountInfo(reserve);
        if (!info) return;

        const decoded = decodeReserveInfo(info.data as Buffer);
        if (!decoded) return;

        const available = Number(decoded.availableAmount) / 1e6;
        const borrowed = Number(decoded.borrowedAmountSf >> 60n) / 1e6;
        const total = available + borrowed;
        const util = total > 0 ? borrowed / total : 0;

        setData({
          supplyAPY: decoded.supplyAPY,
          exchangeRate: decoded.exchangeRate,
          cTokenMint: cMint.toBase58(),
          totalDeposited: total,
          utilization: util,
          loading: false,
        });
      } catch (e) {
        console.warn("Failed to fetch reserve data:", e);
        setData((prev) => ({ ...prev, loading: false }));
      }
    };

    fetch();
    const interval = setInterval(fetch, 30_000);
    return () => clearInterval(interval);
  }, [connection]);

  return data;
}
