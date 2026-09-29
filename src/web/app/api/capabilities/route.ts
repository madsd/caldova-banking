import { listBankingCapabilities } from "@/lib/banking-capabilities";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ capabilities: listBankingCapabilities() });
}
