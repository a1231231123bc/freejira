import { env } from 'cloudflare:workers';
import { handle } from '../../../lib/freejira/api';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return handle(request, env.DB!, env.BUCKET);
}
export const POST = GET;
export const PATCH = GET;
export const PUT = GET;
export const DELETE = GET;
