import { env } from 'cloudflare:workers';
import { videoHandle } from '../../../../lib/video/api';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return videoHandle(request, env);
}
export const POST = GET;
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
export const HEAD = GET;
