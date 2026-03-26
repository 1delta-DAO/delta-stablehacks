import { useState, useCallback, useEffect } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import {
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
} from "@solana/spl-token";
import { usePrograms } from "../hooks/usePrograms";
import Dropdown from "../components/Dropdown";

export default function MintPanel() {
  const { publicKey, connected, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const { config, ready } = usePrograms();

  const [selectedToken, setSelectedToken] = useState(0);
  const [mintAmount, setMintAmount] = useState("1000");
  const [underlyingBalances, setUnderlyingBalances] = useState<Record<string, string>>({});
  const [wrappedBalances, setWrappedBalances] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ msg: string; type: "ok" | "err" | "info" } | null>(null);
  const [loading, setLoading] = useState(false);

  const tokens = config.tokens || [];
  const token = tokens[selectedToken];

  // Load balances for both underlying and wrapped
  useEffect(() => {
    if (!publicKey || !connected || tokens.length === 0) return;
    let cancelled = false;

    (async () => {
      const uBals: Record<string, string> = {};
      const wBals: Record<string, string> = {};
      for (const t of tokens) {
        try {
          const uAta = getAssociatedTokenAddressSync(t.underlyingMint, publicKey);
          const uBal = await connection.getTokenAccountBalance(uAta).catch(() => null);
          uBals[t.symbol] = uBal ? (Number(uBal.value.amount) / 10 ** t.decimals).toFixed(2) : "0.00";
        } catch { uBals[t.symbol] = "0.00"; }
        try {
          const wAta = getAssociatedTokenAddressSync(t.wrappedMint, publicKey, false, TOKEN_2022_PROGRAM_ID);
          const wBal = await connection.getTokenAccountBalance(wAta).catch(() => null);
          wBals[t.symbol] = wBal ? (Number(wBal.value.amount) / 10 ** t.decimals).toFixed(2) : "0.00";
        } catch { wBals[t.symbol] = "0.00"; }
      }
      if (!cancelled) { setUnderlyingBalances(uBals); setWrappedBalances(wBals); }
    })();
    return () => { cancelled = true; };
  }, [publicKey, connected, connection, tokens]);

  // Mint underlying tokens (devnet faucet)
  const handleMintUnderlying = useCallback(async () => {
    if (!publicKey || !token || !mintAmount) return;
    setLoading(true);
    setStatus({ msg: `Minting ${mintAmount} ${token.name}...`, type: "info" });

    try {
      const amount = BigInt(Math.floor(Number(mintAmount) * 10 ** token.decimals));
      const ata = getAssociatedTokenAddressSync(token.underlyingMint, publicKey);

      const tx = new Transaction();

      // Create ATA if needed
      const ataInfo = await connection.getAccountInfo(ata);
      if (!ataInfo) {
        tx.add(createAssociatedTokenAccountInstruction(publicKey, ata, publicKey, token.underlyingMint));
      }

      // Mint underlying tokens — the deployer wallet is the mint authority
      // On devnet, only the deployer can call this. If the connected wallet
      // is not the mint authority, this will fail with a helpful message.
      tx.add(createMintToInstruction(
        token.underlyingMint,
        ata,
        publicKey, // mint authority must be signer
        amount,
      ));

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");

      setStatus({ msg: `Minted ${mintAmount} ${token.name}! Now go to Wrap tab to create d-tokens. Tx: ${sig.slice(0, 20)}...`, type: "ok" });
      setMintAmount("");

      // Refresh balance
      const bal = await connection.getTokenAccountBalance(ata).catch(() => null);
      if (bal) setUnderlyingBalances(prev => ({ ...prev, [token.symbol]: (Number(bal.value.amount) / 10 ** token.decimals).toFixed(2) }));
    } catch (e: any) {
      const msg = e.message?.includes("owner does not match")
        ? "Only the mint authority (deployer wallet) can mint test tokens."
        : `Failed: ${e.message?.slice(0, 100)}`;
      setStatus({ msg, type: "err" });
    }
    setLoading(false);
  }, [publicKey, token, mintAmount, connection, sendTransaction]);

  if (!connected) return <p className="opacity-50">Connect wallet to use the faucet.</p>;
  if (tokens.length === 0) return <p className="opacity-50">No tokens configured.</p>;

  return (
    <div className="flex flex-col gap-6">
      <p className="opacity-50 text-sm">
        Mint test underlying tokens (devnet only). Then go to the <strong>Wrap</strong> tab to convert them into KYC-gated d-tokens.
      </p>

      {status && (
        <div role="alert" className={`alert ${status.type === "ok" ? "alert-success" : status.type === "err" ? "alert-error" : "alert-info"}`}>
          <span className="text-sm break-all">{status.msg}</span>
        </div>
      )}

      {/* Balances */}
      <div className="card bg-base-200 border border-base-300 shadow-sm">
        <div className="card-body p-6 gap-4">
          <h3 className="card-title text-base">Your Balances</h3>
          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Token</th>
                  <th className="text-right">Underlying</th>
                  <th className="text-right">d-Token (wrapped)</th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((t) => (
                  <tr key={t.symbol}>
                    <td className="font-semibold">{t.name}</td>
                    <td className="text-right font-mono">{underlyingBalances[t.symbol] ?? "..."}</td>
                    <td className="text-right font-mono text-success">{wrappedBalances[t.symbol] ?? "..."}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Mint Form */}
      <div className="card bg-base-200 border border-base-300 shadow-sm">
        <div className="card-body p-6 gap-4">
          <h3 className="card-title text-base">Mint Test Tokens</h3>
          <p className="text-xs opacity-40">
            Mints underlying tokens to your wallet. Requires the connected wallet to be the mint authority (deployer).
          </p>
          <div className="flex gap-3">
            <Dropdown
              value={selectedToken}
              onChange={(v) => setSelectedToken(Number(v))}
              options={tokens.map((t, i) => ({ value: i, label: `${t.name} ($${t.price})` }))}
              className="min-w-[180px]"
            />
            <input
              placeholder="Amount"
              value={mintAmount}
              onChange={(e) => setMintAmount(e.target.value)}
              inputMode="decimal" pattern="[0-9.]*"
              className="input input-bordered bg-base-200 text-base-content font-mono flex-1"
            />
            <button
              onClick={handleMintUnderlying}
              disabled={loading || !token}
              className="btn btn-primary"
            >
              {loading ? "Minting..." : `Mint ${token?.name}`}
            </button>
          </div>
        </div>
      </div>

      {/* Flow guide */}
      <div className="card bg-base-200 border border-base-300 shadow-sm">
        <div className="card-body p-6 gap-4">
          <h3 className="card-title text-sm opacity-70">How it works</h3>
          <ul className="steps steps-vertical text-sm">
            <li className="step step-primary">Mint underlying tokens here (Faucet)</li>
            <li className="step">Wrap them into d-tokens on the Wrap tab (requires KYC)</li>
            <li className="step">Deposit d-tokens as collateral on the Lending tab</li>
            <li className="step">Borrow USDC against your collateral</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
