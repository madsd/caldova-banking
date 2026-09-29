export const runtime = "nodejs";

export async function GET() {
  const foundryConfigured = Boolean(process.env.FOUNDRY_PROJECT_ENDPOINT);
  return Response.json(
    {
      status:
        process.env.NODE_ENV === "production" && !foundryConfigured
          ? "degraded"
          : "healthy",
      foundryConfigured,
      timestamp: new Date().toISOString(),
    },
    {
      status:
        process.env.NODE_ENV === "production" && !foundryConfigured ? 503 : 200,
    },
  );
}
