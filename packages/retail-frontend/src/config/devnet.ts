import { PublicKey } from "@solana/web3.js";

export const DEVNET_CONFIG = {
  cluster: "devnet" as const,
  rpc: "https://api.devnet.solana.com",

  programs: {
    deltaMint: new PublicKey("13Su8nR5NBzQ7UwFFUiNAH1zH5DQtLyjezhbwRREQkEn"),
    governor: new PublicKey("BrZYcbPBt9nW4b6xUSodwXRfAfRNZTCzthp1ywMG3KJh"),
    klend: new PublicKey("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"),
  },

  pool: {
    poolConfig: new PublicKey("5dkknYzVfeVdwNSxR1gUXTz2mKoXEtFhZ8jnDCduFRpb"),
    wrappedMint: new PublicKey("ALqRkS5GdVYWUFLzsL3xbKCxkoMxe2p23UUP9Waddwfx"),
    underlyingMint: new PublicKey("A1KLoBrKBde8Ty9qtNQUtq3C2ortoC3u7twggz7sEto6"),
    dmMintConfig: new PublicKey("C8XZRejf1vaLRpLWqCZSjegzyAFFdfpBZKXFhs7kSDLs"),
    dmMintAuthority: new PublicKey("DWat3MjbT3HmHjwutDKqN9ooSNtVyFVgfTm3gs7drYS2"),
  },

  // USDC on devnet — the test mint used by the klend reserve (we control mint authority)
  usdc: {
    mint: new PublicKey("2tboZ672zptawbXLUrcqfF7YkkS1kzDS4ewwxtjuog1G"),
    decimals: 6,
  },

  // Civic gatekeeper network (uniqueness — liveness only for devnet)
  civic: {
    gatekeeperNetwork: new PublicKey("ignREusXmGrscGNUesoU9mxfds9AiYTezUKex2PsZV6"),
  },

  // Lending market
  market: {
    lendingMarket: new PublicKey("45FNL648aXgbMoMzLfYE2vCZAtWWDCky2tYLCEUztc98"),
    usdcReserve: new PublicKey("D4qXufDqBjU5iTbVMHfdxDrpYnz31sed1oQCJbWoVGmH"),
    usdcOracle: new PublicKey("HSi8jh6q9XrbMrHi84G2QFafS3sfuo23hewTNBVPQ9EF"),
    dUsdyReserve: new PublicKey("HoEa26bHi96mwAu3joQZKcyxhG9jXyJvaxLNuvjcwZmw"),
    dUsdyOracle: new PublicKey("E4pitSrZV9MWSspahe2vr26Cwsn3podnvHvW3cuT74R4"),
  },
};

export type DeploymentConfig = typeof DEVNET_CONFIG;
