import { env } from 'cloudflare:workers';
import { handle } from '../../lib/freejira/api';
export const dynamic = 'force-dynamic';
export function POST(request: Request) {
  return handle(request, env.DB!, env.BUCKET);
}
export function GET() {
  return new Response('Use POST', { status: 405, headers: { Allow: 'POST' } });
}
