declare module "cloudflare:workers" {
  export const env: Record<string, unknown>;
}

type Fetcher = {
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
};
