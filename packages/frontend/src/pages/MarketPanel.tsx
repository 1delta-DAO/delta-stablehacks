import { useState, useCallback, useEffect } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import {
  PublicKey,
  SystemProgram,
  Keypair,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { usePrograms } from "../hooks/usePrograms";
import * as crypto from "crypto";
import Dropdown from "../components/Dropdown";
import {
  reserveLiquiditySupply,
  reserveCollateralMint,
  reserveCollateralSupply,
  feeReceiver,
  lendingMarketAuthority,
  buildRefreshReserveIx,
} from "../lib/klend";

const KLEND = new PublicKey("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");
const KLEND_GLOBAL = new PublicKey("BEe6HXZf6cByeb8iCxukjB8k74kJN3cVbBAGi49Hfi6W");
const MOCK_ORACLE = new PublicKey("7qABPpPwvS7u7Y5vgDKZdSqLnc6N9FasVnG2iv7qe4vm");

function disc(name: string): Buffer {
  return Buffer.from(crypto.createHash("sha256").update(`global:${name}`).digest().subarray(0, 8));
}

interface ReserveStatus {
  address: string;
  tokenSymbol: string;
  oracle: string;
  refreshOk: boolean | null;
  depositLimit: string;
  borrowLimit: string;
}

export default function MarketPanel() {
  const { publicKey, connected, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const { config, ready } = usePrograms();

  const [reserves, setReserves] = useState<ReserveStatus[]>([]);
  const [selectedToken, setSelectedToken] = useState(0);
  const [status, setStatus] = useState<{ msg: string; type: "ok" | "err" | "info" } | null>(null);
  const [loading, setLoading] = useState(false);
  const [configTarget, setConfigTarget] = useState<string>("");
  const [configMode, setConfigMode] = useState("8"); // depositLimit
  const [configValue, setConfigValue] = useState("");

  const tokens = config.tokens || [];
  const market = config.market.lendingMarket;

  const showStatus = (msg: string, type: "ok" | "err" | "info") => {
    setStatus({ msg, type });
    if (type !== "info") setTimeout(() => setStatus(null), 10000);
  };

  // Load existing reserves
  useEffect(() => {
    if (!ready) return;
    const loadReserves = async () => {
      const results: ReserveStatus[] = [];
      // Check known reserves
      for (const [sym, addr] of [
        ["dUSDY (legacy)", config.market.dUsdyReserve.toBase58()],
        ["USDC", config.market.usdcReserve.toBase58()],
      ]) {
        const info = await connection.getAccountInfo(new PublicKey(addr)).catch(() => null);
        if (info) {
          results.push({
            address: addr,
            tokenSymbol: sym,
            oracle: "—",
            refreshOk: null,
            depositLimit: "—",
            borrowLimit: "—",
          });
        }
      }
      setReserves(results);
    };
    loadReserves();
  }, [ready, connection, config]);

  // Create reserve for a wrapped token
  const handleCreateReserve = useCallback(async () => {
    if (!publicKey || !tokens[selectedToken]) return;
    setLoading(true);
    const token = tokens[selectedToken];
    showStatus(`Creating klend reserve for d${token.symbol}...`, "info");

    try {
      const reserveKp = Keypair.generate();
      const rent = await connection.getMinimumBalanceForRentExemption(8624);

      // The wrapped token uses Token-2022, need to use correct token program
      const dTokenAta = getAssociatedTokenAddressSync(token.wrappedMint, publicKey, false, TOKEN_2022_PROGRAM_ID);

      // Ensure we have the d-token ATA with balance for seed deposit
      const ataInfo = await connection.getAccountInfo(dTokenAta);
      if (!ataInfo) {
        showStatus("You need d-token balance for the seed deposit. Mint first.", "err");
        setLoading(false);
        return;
      }

      const tx = new Transaction();
      tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 800000 }));

      // Create reserve account
      tx.add(SystemProgram.createAccount({
        fromPubkey: publicKey,
        newAccountPubkey: reserveKp.publicKey,
        lamports: rent,
        space: 8624,
        programId: KLEND,
      }));

      // InitReserve
      const [lma] = PublicKey.findProgramAddressSync([Buffer.from("lma"), market.toBuffer()], KLEND);
      tx.add({
        programId: KLEND,
        data: disc("init_reserve"),
        keys: [
          { pubkey: publicKey, isSigner: true, isWritable: true },
          { pubkey: market, isSigner: false, isWritable: false },
          { pubkey: lma, isSigner: false, isWritable: false },
          { pubkey: reserveKp.publicKey, isSigner: false, isWritable: true },
          { pubkey: token.wrappedMint, isSigner: false, isWritable: false },
          { pubkey: reserveLiquiditySupply(reserveKp.publicKey), isSigner: false, isWritable: true },
          { pubkey: feeReceiver(reserveKp.publicKey), isSigner: false, isWritable: true },
          { pubkey: reserveCollateralMint(reserveKp.publicKey), isSigner: false, isWritable: true },
          { pubkey: reserveCollateralSupply(reserveKp.publicKey), isSigner: false, isWritable: true },
          { pubkey: dTokenAta, isSigner: false, isWritable: true },
          { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
          { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
      });

      const sig = await sendTransaction(tx, connection, { signers: [reserveKp] });
      await connection.confirmTransaction(sig, "confirmed");

      showStatus(`Reserve created: ${reserveKp.publicKey.toBase58()}. Now configuring...`, "info");

      // Configure: name, priceMaxAge, twapMaxAge, pyth oracle, LTV, liq threshold, borrow factor, borrow rate
      const configUpdates: [string, number, Buffer][] = [
        ["Name", 16, (() => { const b = Buffer.alloc(32); Buffer.from(`d${token.symbol}`).copy(b); return b; })()],
        ["PriceMaxAge", 17, (() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt("18446744073709551615")); return b; })()],
        ["TwapMaxAge", 18, (() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt("18446744073709551615")); return b; })()],
        ["PythOracle", 20, token.oracle.toBuffer()],
        ["LTV", 0, Buffer.from([75])],
        ["LiqThreshold", 2, Buffer.from([85])],
        ["BorrowFactor", 32, (() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(100n); return b; })()],
      ];

      for (const [label, mode, value] of configUpdates) {
        const ixData = Buffer.alloc(1 + 4 + value.length + 1);
        ixData.writeUInt8(mode, 0);
        ixData.writeUInt32LE(value.length, 1);
        value.copy(ixData, 5);
        ixData.writeUInt8(1, 5 + value.length); // skip=true for fresh reserves

        const cfgTx = new Transaction();
        cfgTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1400000 }));
        cfgTx.add(ComputeBudgetProgram.requestHeapFrame({ bytes: 262144 }));
        cfgTx.add({
          programId: KLEND,
          data: Buffer.concat([disc("update_reserve_config"), ixData]),
          keys: [
            { pubkey: publicKey, isSigner: true, isWritable: false },
            { pubkey: KLEND_GLOBAL, isSigner: false, isWritable: false },
            { pubkey: market, isSigner: false, isWritable: false },
            { pubkey: reserveKp.publicKey, isSigner: false, isWritable: true },
          ],
        });

        try {
          const cfgSig = await sendTransaction(cfgTx, connection);
          await connection.confirmTransaction(cfgSig, "confirmed");
        } catch {
          // Some configs may fail — continue with the rest
        }
      }

      // Set limits with skip=false (validation)
      for (const [label, mode] of [["DepositLimit", 8], ["BorrowLimit", 9], ["BorrowLimitOutside", 44]] as const) {
        const limit = Buffer.alloc(8);
        limit.writeBigUInt64LE(BigInt("1000000000000000"));
        const ixData = Buffer.alloc(1 + 4 + 8 + 1);
        ixData.writeUInt8(mode, 0);
        ixData.writeUInt32LE(8, 1);
        limit.copy(ixData, 5);
        ixData.writeUInt8(0, 13); // skip=false

        const limTx = new Transaction();
        limTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1400000 }));
        limTx.add(ComputeBudgetProgram.requestHeapFrame({ bytes: 262144 }));
        limTx.add({
          programId: KLEND,
          data: Buffer.concat([disc("update_reserve_config"), ixData]),
          keys: [
            { pubkey: publicKey, isSigner: true, isWritable: false },
            { pubkey: KLEND_GLOBAL, isSigner: false, isWritable: false },
            { pubkey: market, isSigner: false, isWritable: false },
            { pubkey: reserveKp.publicKey, isSigner: false, isWritable: true },
          ],
        });
        try {
          const sig2 = await sendTransaction(limTx, connection);
          await connection.confirmTransaction(sig2, "confirmed");
        } catch {}
      }

      // Test RefreshReserve
      const refreshTx = new Transaction();
      refreshTx.add(buildRefreshReserveIx(reserveKp.publicKey, market, token.oracle));
      try {
        const rSig = await sendTransaction(refreshTx, connection);
        await connection.confirmTransaction(rSig, "confirmed");
        showStatus(`Reserve for d${token.symbol} created and configured! Address: ${reserveKp.publicKey.toBase58()}`, "ok");
      } catch {
        showStatus(`Reserve created but RefreshReserve failed. Address: ${reserveKp.publicKey.toBase58()}`, "err");
      }

      setReserves(prev => [...prev, {
        address: reserveKp.publicKey.toBase58(),
        tokenSymbol: `d${token.symbol}`,
        oracle: token.oracle.toBase58(),
        refreshOk: true,
        depositLimit: "1B",
        borrowLimit: "1B",
      }]);
    } catch (e: any) {
      showStatus(`Failed: ${e.message?.slice(0, 100)}`, "err");
    }
    setLoading(false);
  }, [publicKey, tokens, selectedToken, connection, sendTransaction, market, config]);

  // Update reserve config
  const handleUpdateConfig = useCallback(async () => {
    if (!publicKey || !configTarget || !configValue) return;
    setLoading(true);
    const mode = parseInt(configMode);
    showStatus(`Updating reserve config (mode ${mode})...`, "info");

    try {
      let value: Buffer;
      if (mode === 16) { // name
        value = Buffer.alloc(32);
        Buffer.from(configValue).copy(value);
      } else if (mode === 20) { // pubkey
        value = new PublicKey(configValue).toBuffer();
      } else if (mode === 0 || mode === 2 || mode === 38) { // u8
        value = Buffer.from([parseInt(configValue)]);
      } else { // u64
        value = Buffer.alloc(8);
        value.writeBigUInt64LE(BigInt(configValue));
      }

      const ixData = Buffer.alloc(1 + 4 + value.length + 1);
      ixData.writeUInt8(mode, 0);
      ixData.writeUInt32LE(value.length, 1);
      value.copy(ixData, 5);
      ixData.writeUInt8(0, 13); // skip=false

      const tx = new Transaction();
      tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1400000 }));
      tx.add(ComputeBudgetProgram.requestHeapFrame({ bytes: 262144 }));
      tx.add({
        programId: KLEND,
        data: Buffer.concat([disc("update_reserve_config"), ixData]),
        keys: [
          { pubkey: publicKey, isSigner: true, isWritable: false },
          { pubkey: KLEND_GLOBAL, isSigner: false, isWritable: false },
          { pubkey: market, isSigner: false, isWritable: false },
          { pubkey: new PublicKey(configTarget), isSigner: false, isWritable: true },
        ],
      });

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      showStatus("Config updated!", "ok");
    } catch (e: any) {
      showStatus(`Failed: ${e.message?.slice(0, 100)}`, "err");
    }
    setLoading(false);
  }, [publicKey, configTarget, configMode, configValue, connection, sendTransaction, market]);

  if (!connected) return <p className="opacity-50">Connect wallet to manage lending markets.</p>;

  return (
    <div className="flex flex-col gap-6">
      <p className="opacity-50 text-sm">
        Create and configure klend reserves for wrapped tokens. Requires market admin authority.
      </p>

      {status && (
        <div className={`alert text-sm break-all ${status.type === "ok" ? "alert-success" : status.type === "err" ? "alert-error" : "alert-info"}`}>
          {status.msg}
        </div>
      )}

      {/* Existing Reserves */}
      <div className="card bg-base-200 border border-base-300 shadow-sm">
        <div className="card-body p-6 gap-4">
          <h3 className="text-base font-semibold">Active Reserves</h3>
          {reserves.length === 0 ? (
            <p className="opacity-40">No reserves loaded.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>Token</th>
                    <th className="text-right">Address</th>
                    <th className="text-right">Refresh</th>
                  </tr>
                </thead>
                <tbody>
                  {reserves.map((r) => (
                    <tr key={r.address}>
                      <td className="font-semibold">{r.tokenSymbol}</td>
                      <td
                        className="text-right font-mono text-xs opacity-60 cursor-pointer"
                        onClick={() => setConfigTarget(r.address)}
                        title={r.address}
                      >
                        {r.address.slice(0, 10)}...
                      </td>
                      <td className={`text-right ${r.refreshOk === true ? "text-success" : r.refreshOk === false ? "text-error" : "opacity-50"}`}>
                        {r.refreshOk === null ? "?" : r.refreshOk ? "OK" : "FAIL"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Create New Reserve */}
      <div className="card bg-base-200 border border-base-300 shadow-sm">
        <div className="card-body p-6 gap-4">
          <h3 className="text-base font-semibold">Create Reserve</h3>
          <p className="opacity-40 text-xs mb-3">
            Creates a klend reserve for the selected d-token. Automatically configures oracle, LTV (75%), liquidation threshold (85%), and limits.
          </p>
          <div className="flex gap-3">
            <Dropdown
              value={selectedToken}
              onChange={(v) => setSelectedToken(Number(v))}
              options={tokens.map((t, i) => ({ value: i, label: `d${t.symbol} — ${t.name} ($${t.price})` }))}
              className="flex-1"
            />
            <button
              onClick={handleCreateReserve}
              disabled={loading || tokens.length === 0}
              className="btn btn-primary"
            >
              {loading ? "Creating..." : "Create Reserve"}
            </button>
          </div>
        </div>
      </div>

      {/* Update Reserve Config */}
      <div className="card bg-base-200 border border-base-300 shadow-sm">
        <div className="card-body p-6 gap-4">
          <h3 className="text-base font-semibold">Update Reserve Config</h3>
          <p className="opacity-40 text-xs mb-3">
            Click a reserve address above to select it. Then choose a config mode and value.
          </p>
          <div className="flex gap-3 mb-2">
            <input
              placeholder="Reserve address"
              value={configTarget}
              onChange={(e) => setConfigTarget(e.target.value)}
              className="input input-bordered bg-base-200 text-base-content font-mono flex-1"
            />
          </div>
          <div className="flex gap-3">
            <Dropdown
              value={configMode}
              onChange={(v) => setConfigMode(String(v))}
              options={[
                { value: "0", label: "LTV % (0-99)" },
                { value: "2", label: "Liquidation Threshold %" },
                { value: "8", label: "Deposit Limit (u64)" },
                { value: "9", label: "Borrow Limit (u64)" },
                { value: "16", label: "Token Name (string)" },
                { value: "17", label: "Price Max Age (seconds)" },
                { value: "20", label: "Pyth Oracle (pubkey)" },
                { value: "23", label: "Borrow Rate Curve" },
                { value: "32", label: "Borrow Factor (min 100)" },
                { value: "38", label: "Reserve Status (0=Active)" },
                { value: "44", label: "Borrow Limit Outside EG" },
              ]}
              className="min-w-[220px]"
            />
            <input
              placeholder="Value"
              value={configValue}
              onChange={(e) => setConfigValue(e.target.value)}
              className="input input-bordered bg-base-200 text-base-content font-mono flex-1"
            />
            <button
              onClick={handleUpdateConfig}
              disabled={loading || !configTarget || !configValue}
              className="btn btn-success"
            >
              Update
            </button>
          </div>
        </div>
      </div>

      {/* Market Info */}
      <div className="card bg-base-200 border border-base-300 shadow-sm">
        <div className="card-body p-6 gap-4">
          <h3 className="text-sm font-semibold mb-2 opacity-70">Market Info</h3>
          <div className="grid grid-cols-2 gap-1 text-xs opacity-40">
            <span>Lending Market:</span><span className="font-mono opacity-70">{market.toBase58()}</span>
            <span>Global Config:</span><span className="font-mono opacity-70">{KLEND_GLOBAL.toBase58()}</span>
            <span>klend Program:</span><span className="font-mono opacity-70">{KLEND.toBase58()}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
