import { useState, useEffect, useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { reserveCollateralMint } from "../lib/klend";
import { DEVNET_CONFIG } from "../config/devnet";

export interface CTokenBalance {
  /** Raw cToken balance in native units */
  cTokens: number;
  /** Estimated USDC value based on exchange rate */
  usdcValue: number;
  /** cToken mint address */
  cTokenMint: PublicKey;
  loading: boolean;
  /** Call to immediately refresh the balance */
  refresh: () => void;
}

export function useCTokenBalance(exchangeRate: number): CTokenBalance {
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  const [refreshCount, setRefreshCount] = useState(0);
  const refresh = useCallback(() => setRefreshCount((c) => c + 1), []);

  const [balance, setBalance] = useState<CTokenBalance>({
    cTokens: 0,
    usdcValue: 0,
    cTokenMint: PublicKey.default,
    loading: true,
    refresh,
  });

  useEffect(() => {
    if (!publicKey || !connected) {
      setBalance({ cTokens: 0, usdcValue: 0, cTokenMint: PublicKey.default, loading: false, refresh });
      return;
    }

    const cMint = reserveCollateralMint(DEVNET_CONFIG.market.usdcReserve);

    const fetchBal = async () => {
      try {
        const ata = getAssociatedTokenAddressSync(cMint, publicKey, false, TOKEN_PROGRAM_ID);
        const bal = await connection.getTokenAccountBalance(ata);
        const cTokens = Number(bal.value.uiAmount || 0);
        const usdcValue = cTokens * exchangeRate;
        setBalance({ cTokens, usdcValue, cTokenMint: cMint, loading: false, refresh });
      } catch {
        // ATA doesn't exist yet — user hasn't deposited
        setBalance({ cTokens: 0, usdcValue: 0, cTokenMint: cMint, loading: false, refresh });
      }
    };

    fetchBal();
    const interval = setInterval(fetchBal, 15_000);
    return () => clearInterval(interval);
  }, [publicKey, connected, connection, exchangeRate, refreshCount, refresh]);

  return balance;
}
