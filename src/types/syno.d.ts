declare module "syno" {
  interface SynoOptions {
    ignoreCertificateErrors: boolean;
    host: string;
    port: string | number;
    mac: string;
    account: string;
    passwd: string;
    protocol: "http" | "https";
    apiVersion: string;
    otp: string | false;
    debug: boolean;
  }

  type SynoCallback = (error: SynoError | null, response?: unknown) => void;
  type SynoMethod = (
    params?: Record<string, unknown> | null,
    callback?: SynoCallback,
  ) => void;

  interface SynoError extends Error {
    code?: number | string;
    errors?: unknown[];
  }

  interface SynoClient {
    host: string;
    port: string | number;
    protocol: "http" | "https";
    mac: string;
    sessions: Record<string, { _sid?: string } | string | undefined>;
    dsm: Record<string, SynoMethod>;
    fs: Record<string, SynoMethod>;
    dl: Record<string, SynoMethod>;
    as: Record<string, SynoMethod>;
    vs: Record<string, SynoMethod>;
    dtv: Record<string, SynoMethod>;
    ss: Record<string, SynoMethod>;
  }

  class Syno implements SynoClient {
    constructor(options: SynoOptions);
    host: string;
    port: string | number;
    protocol: "http" | "https";
    mac: string;
    sessions: SynoClient["sessions"];
    dsm: Record<string, SynoMethod>;
    fs: Record<string, SynoMethod>;
    dl: Record<string, SynoMethod>;
    as: Record<string, SynoMethod>;
    vs: Record<string, SynoMethod>;
    dtv: Record<string, SynoMethod>;
    ss: Record<string, SynoMethod>;
  }

  export = Syno;
}
