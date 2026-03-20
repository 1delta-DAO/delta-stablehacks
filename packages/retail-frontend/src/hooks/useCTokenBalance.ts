import { useState, useEffect } from "react";
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
}

export function useCTokenBalance(exchangeRate: number): CTokenBalance {
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  const [balance, setBalance] = useState<CTokenBalance>({
    cTokens: 0,
    usdcValue: 0,
    cTokenMint: PublicKey.default,
    loading: true,
  });

  useEffect(() => {
    if (!publicKey || !connected) {
      setBalance({ cTokens: 0, usdcValue: 0, cTokenMint: PublicKey.default, loading: false });
      return;
    }

    const cMint = reserveCollateralMint(DEVNET_CONFIG.market.usdcReserve);

    const fetch = async () => {
      try {
        const ata = getAssociatedTokenAddressSync(cMint, publicKey, false, TOKEN_PROGRAM_ID);
        const bal = await connection.getTokenAccountBalance(ata);
        const cTokens = Number(bal.value.uiAmount || 0);
        const usdcValue = cTokens * exchangeRate;
        setBalance({ cTokens, usdcValue, cTokenMint: cMint, loading: false });
      } catch {
        // ATA doesn't exist yet — user hasn't deposited
        setBalance({ cTokens: 0, usdcValue: 0, cTokenMint: cMint, loading: false });
      }
    };

    fetch();
    const interval = setInterval(fetch, 15_000);
    return () => clearInterval(interval);
  }, [publicKey, connected, connection, exchangeRate]);

  return balance;
}
