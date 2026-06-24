export default {
  async fetch(_request: Request, _env: unknown): Promise<Response> {
    return new Response('ca-liquidity-dashboard', { status: 200 });
  },
  async scheduled(_event: unknown, _env: unknown, _ctx: unknown): Promise<void> {
    // ingest cron – to be implemented
  },
};
