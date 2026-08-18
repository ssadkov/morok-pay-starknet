import { parseSourceDomain } from "@/lib/cctp/attestation";
import { irisTransactionHash } from "@/lib/cctp/bytes";
import { cctpOf } from "@/lib/cctp/constants";
import { parseAppNetwork } from "@/lib/network";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const hash = url.searchParams.get("transactionHash");
  if (!hash || !/^0x[0-9a-fA-F]{16,}$/.test(hash)) {
    return Response.json({ error: "Invalid transaction hash" }, { status: 400 });
  }

  let sourceDomain: number;
  let irisHash: string;
  let irisBase: string;
  try {
    sourceDomain = parseSourceDomain(url.searchParams.get("sourceDomain"));
    irisHash = irisTransactionHash(hash);
    irisBase = cctpOf(parseAppNetwork(url.searchParams.get("network"))).iris;
  } catch {
    return Response.json({ error: "Invalid CCTP request" }, { status: 400 });
  }

  const iris = `${irisBase}/${sourceDomain}?transactionHash=${encodeURIComponent(irisHash)}`;
  const response = await fetch(iris, { cache: "no-store" });
  const body = await response.text();
  return new Response(body, {
    status: response.status,
    headers: { "content-type": "application/json" },
  });
}
