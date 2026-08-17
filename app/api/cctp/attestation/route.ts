import { IRIS_API_URL } from "@/lib/cctp/constants";

export async function GET(request: Request) {
  const hash = new URL(request.url).searchParams.get("transactionHash");
  if (!hash || !/^0x[0-9a-fA-F]{16,}$/.test(hash)) {
    return Response.json({ error: "Invalid transaction hash" }, { status: 400 });
  }

  const iris = `${IRIS_API_URL}/${0}?transactionHash=${encodeURIComponent(hash)}`;
  const response = await fetch(iris, { cache: "no-store" });
  const body = await response.text();
  return new Response(body, {
    status: response.status,
    headers: { "content-type": "application/json" },
  });
}
