declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    VIDEO_WORKER_TOKEN?: string;
  }
}
