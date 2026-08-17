export function GET() {
  const proving = Boolean(process.env.STRK20_PROVING_URL);
  const indexer = Boolean(process.env.STRK20_INDEXER_URL);
  return Response.json({
    configured: proving && indexer,
    proving,
    indexer,
  });
}
