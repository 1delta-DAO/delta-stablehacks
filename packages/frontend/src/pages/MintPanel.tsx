import { useState, useCallback, useEffect } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { usePrograms } from "../hooks/usePrograms";
import { Program, BN } from "@coral-xyz/anchor";

export default function MintPanel() {
  const { publicKey, connected, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const { config, governor, ready } = usePrograms();

  const [selectedToken, setSelectedToken] = useState(0);
  const [mintAmount, setMintAmount] = useState("1000");
  const [balances, setBalances] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ msg: string; type: "ok" | "err" | "info" } | null>(null);
  const [loading, setLoading] = useState(false);

  const tokens = config.tokens || [];
  const token = tokens[selectedToken];

  // Load balances
  useEffect(() => {
    if (!publicKey || !connected || tokens.length === 0) return;
    let cancelled = false;

    (async () => {
      const bals: Record<string, string> = {};
      for (const t of tokens) {
        try {
          const ata = getAssociatedTokenAddressSync(t.wrappedMint, publicKey, false, TOKEN_2022_PROGRAM_ID);
          const bal = await connection.getTokenAccountBalance(ata).catch(() => null);
          bals[t.symbol] = bal ? (Number(bal.value.amount) / 10 ** t.decimals).toFixed(2) : "0.00";
        } catch {
          bals[t.symbol] = "0.00";
        }
      }
      if (!cancelled) setBalances(bals);
    })();
    return () => { cancelled = true; };
  }, [publicKey, connected, connection, tokens]);

  const handleMint = useCallback(async () => {
    if (!publicKey || !governor || !token || !mintAmount) return;
    setLoading(true);
    setStatus({ msg: `Minting ${mintAmount} d${token.symbol}...`, type: "info" });

    try {
      const amount = new BN(Math.floor(Number(mintAmount) * 10 ** token.decimals));
      const ata = getAssociatedTokenAddressSync(token.wrappedMint, publicKey, false, TOKEN_2022_PROGRAM_ID);

      // Derive PDAs
      const [dmMintAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from("mint_authority"), token.wrappedMint.toBuffer()],
        config.programs.deltaMint
      );
      const [whitelistEntry] = PublicKey.findProgramAddressSync(
        [Buffer.from("whitelist"), token.dmMintConfig.toBuffer(), publicKey.toBuffer()],
        config.programs.deltaMint
      );

      // Check if admin (derive admin PDA)
      const rootAuthority = "AhKNmBmaeq6XrrEyGnSQne3WeU4SoN7hSAGieTiqPaJX";
      const isRoot = publicKey.toBase58() === rootAuthority;
      let adminEntry: PublicKey | null = null;
      if (!isRoot) {
        const [ae] = PublicKey.findProgramAddressSync(
          [Buffer.from("admin"), token.pool.toBuffer(), publicKey.toBuffer()],
          config.programs.governor
        );
        const aeInfo = await connection.getAccountInfo(ae);
        if (aeInfo) adminEntry = ae;
      }

      const tx = new Transaction();

      // Create ATA if needed
      const ataInfo = await connection.getAccountInfo(ata);
      if (!ataInfo) {
        tx.add(createAssociatedTokenAccountInstruction(publicKey, ata, publicKey, token.wrappedMint, TOKEN_2022_PROGRAM_ID));
      }

      // Mint via governor
      const mintAccounts: any = {
        authority: publicKey,
        poolConfig: token.pool,
        adminEntry: adminEntry,
        dmMintConfig: token.dmMintConfig,
        wrappedMint: token.wrappedMint,
        dmMintAuthority,
        whitelistEntry,
        destination: ata,
        deltaMintProgram: config.programs.deltaMint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      };

      const ix = await (governor.methods as any)
        .mintWrapped(amount)
        .accounts(mintAccounts)
        .instruction();
      tx.add(ix);

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");

      setStatus({ msg: `Minted ${mintAmount} d${token.symbol}! Tx: ${sig.slice(0, 20)}...`, type: "ok" });

      // Refresh balance
      const bal = await connection.getTokenAccountBalance(ata).catch(() => null);
      if (bal) setBalances(prev => ({ ...prev, [token.symbol]: (Number(bal.value.amount) / 10 ** token.decimals).toFixed(2) }));
    } catch (e: any) {
      setStatus({ msg: `Failed: ${e.message?.slice(0, 100)}`, type: "err" });
    }
    setLoading(false);
  }, [publicKey, governor, token, mintAmount, connection, sendTransaction, config]);

  if (!connected) return <p className="opacity-50">Connect wallet to mint tokens.</p>;
  if (tokens.length === 0) return <p className="opacity-50">No wrapped tokens configured.</p>;

  return (
    <div className="flex flex-col gap-6">
      <p className="opacity-50 text-sm">
        Mint KYC-wrapped d-tokens for testing. Requires admin or whitelisted wallet.
      </p>

      {status && (
        <div className={`alert text-sm break-all ${status.type === "ok" ? "alert-success" : status.type === "err" ? "alert-error" : "alert-info"}`}>
          {status.msg}
        </div>
      )}

      {/* Balances */}
      <div className="card bg-base-200 border border-base-300 shadow-sm">
        <div className="card-body p-6 gap-4">
          <h3 className="text-base font-semibold">Your d-Token Balances</h3>
          <div className={`grid gap-4 text-center ${tokens.length >= 4 ? "grid-cols-4" : tokens.length === 3 ? "grid-cols-3" : tokens.length === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
            {tokens.map((t) => (
              <div key={t.symbol}>
                <div className="text-2xl font-semibold font-mono">
                  {balances[t.symbol] ?? "..."}
                </div>
                <div className="text-xs opacity-50 mt-1">
                  <span className="text-success">d{t.symbol}</span> ({t.name})
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Mint Form */}
      <div className="card bg-base-200 border border-base-300 shadow-sm">
        <div className="card-body p-6 gap-4">
          <h3 className="text-base font-semibold">Mint d-Tokens</h3>
          <div className="flex gap-3 mb-3">
            <select
              value={selectedToken}
              onChange={(e) => setSelectedToken(Number(e.target.value))}
              className="select select-bordered min-w-[180px]"
            >
              {tokens.map((t, i) => (
                <option key={t.symbol} value={i}>d{t.symbol} — {t.name} (${t.price})</option>
              ))}
            </select>
            <input
              placeholder="Amount"
              value={mintAmount}
              onChange={(e) => setMintAmount(e.target.value)}
              type="number"
              className="input input-bordered font-mono flex-1"
            />
            <button
              onClick={handleMint}
              disabled={loading || !token}
              className="btn btn-success"
            >
              {loading ? "..." : `Mint d${token?.symbol}`}
            </button>
          </div>
          {token && (
            <div className="grid grid-cols-2 gap-1 text-xs opacity-40">
              <span>Wrapped Mint:</span><span className="font-mono opacity-70">{token.wrappedMint.toBase58().slice(0, 12)}...</span>
              <span>Pool:</span><span className="font-mono opacity-70">{token.pool.toBase58().slice(0, 12)}...</span>
              <span>Oracle Price:</span><span className="font-mono opacity-70">${token.price}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
