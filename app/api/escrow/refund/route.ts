import { escrowRelayInfo, handleEscrowRequest } from "@/lib/privacy/escrow-server";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = (request: Request) => handleEscrowRequest(request, "refund");
export const GET = (request: Request) => escrowRelayInfo(request, "refund");
