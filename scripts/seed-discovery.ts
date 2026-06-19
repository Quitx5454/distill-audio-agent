// ── Seed CDP x402 Bazaar discovery ────────────────────────────────────────
// Makes ONE real paid 2.00 USDC /generate call so a payment settles on-chain to
// the agent's https resource. The CDP facilitator indexes a resource into the
// public discovery catalog only AFTER a settlement (the Bazaar extension alone
// is not enough). Mirrors distill-agent/scripts/seed-refine.ts.
//
// CDP drops resources after ~30 days with no settlement — re-run ~every 25 days.
//
//   AGENT_WALLET_PRIVATE_KEY=0x... bun run scripts/seed-discovery.ts
// (or WALLET_PRIVATE_KEY=0x...). The payer wallet must hold >= 2.00 USDC on Base.
import { writeFile } from "node:fs/promises";
import { createPublicClient, http as viemHttp } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { toClientEvmSigner } from "@x402/evm";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";

const ENDPOINT = "https://distill-audio-agent-production.up.railway.app/generate";
const RPC_URL = process.env.RPC_URL ?? "https://mainnet.base.org";

const raw = process.env.WALLET_PRIVATE_KEY ?? process.env.AGENT_WALLET_PRIVATE_KEY;
if (!raw) {
  console.error("Set WALLET_PRIVATE_KEY or AGENT_WALLET_PRIVATE_KEY (a Base wallet holding USDC).");
  process.exit(1);
}
const pk = (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
const account = privateKeyToAccount(pk);
const publicClient = createPublicClient({ chain: base, transport: viemHttp(RPC_URL) });
const signer = toClientEvmSigner(
  { address: account.address, signTypedData: (m) => account.signTypedData(m as any) },
  publicClient,
);
const client = new x402Client();
registerExactEvmScheme(client, { signer });
const fetch402 = wrapFetchWithPayment(fetch, client);

// Short ready_text brief, no ASMR — the cheapest real generation that still
// produces a full mp3 and a settled payment to seed discovery.
const body = JSON.stringify({
  brief:
    "Read this exactly as a short, calm note: You are not behind. " +
    "Pick one small thing, do it now, and let that be enough for today.",
  asmr: null,
});

console.log("Payer:   ", account.address);
console.log("Endpoint:", ENDPOINT, "(2.00 USDC, Base mainnet)");

const res = await fetch402(ENDPOINT, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body,
});
console.log("HTTP", res.status);

const payResp = res.headers.get("payment-response");
if (payResp) {
  try {
    const d = JSON.parse(Buffer.from(payResp, "base64").toString("utf-8"));
    console.log("settlement tx:", d.transaction ?? d.txHash ?? JSON.stringify(d));
  } catch {
    console.log("PAYMENT-RESPONSE (raw):", payResp);
  }
}

const ct = res.headers.get("content-type") ?? "";
if (ct.includes("audio")) {
  const buf = Buffer.from(await res.arrayBuffer());
  const out = "/tmp/seed-discovery.mp3";
  await writeFile(out, buf);
  console.log("session_id:", res.headers.get("x-distill-session-id"));
  console.log("mode:     ", res.headers.get("x-distill-mode"));
  console.log("voice:    ", res.headers.get("x-distill-voice"));
  console.log("asmr:     ", res.headers.get("x-distill-asmr"), "applied:", res.headers.get("x-distill-asmr-applied"));
  console.log(`saved ${buf.length} bytes -> ${out}`);
  console.log("\n✓ Settled — CDP indexing is async (~minutes). Re-check the discovery catalog.");
} else {
  console.log("non-audio response:", (await res.text()).slice(0, 500));
  process.exit(1);
}
