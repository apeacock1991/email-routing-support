// Generated by Wrangler by running `wrangler types`

interface Env {
  SUPPORT_CASE: DurableObjectNamespace<import("./src/support_case").SupportCase>;
  MAILGUN_API_KEY: string;
  MAILGUN_DOMAIN: string;
  APP_DOMAIN: string;
  AI: AI;
  RATE_LIMITER: any;
}