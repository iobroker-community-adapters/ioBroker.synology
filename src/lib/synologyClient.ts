import { Syno, type SynoConfig } from "syno";
import * as OTPAuth from "otpauth";
import {
  Agent,
  fetch,
  type RequestInit,
  type Response as UndiciResponse,
} from "undici";

export type StationApi = "dsm" | "fs" | "dl" | "as" | "vs" | "dtv" | "ss";

export interface SynologyClientOptions {
  account: string;
  passwd: string;
  host: string;
  port: number;
  protocol: "http" | "https";
  apiVersion: string;
  ignoreCertificateErrors: boolean;
  twoFactorEnabled: boolean;
  twoFactorSecret?: string;
}

interface SharedHost {
  otpCode?: string;
  request: (url: string, init: RequestInit) => Promise<UndiciResponse>;
}

interface AuthInternals {
  syno: SharedHost;
  login: (sessionName: string) => Promise<{ sid: string }>;
}

interface Station {
  sessionName: string;
  call: (
    methodName: string,
    params?: Record<string, unknown>,
  ) => Promise<unknown>;
}

export interface SynologyClientHandle {
  client: Syno;
  close: () => Promise<void>;
}

const methodAliases: Partial<Record<StationApi, Record<string, string>>> = {
  dtv: { GetInfoTuner: "getInfoTuner" },
  fs: { Clear_invalidSharing: "clearInvalidSharing" },
};

export class SynologyClientError extends Error {
  readonly code?: number | string;
  readonly causeCode?: string;
  readonly authenticationError: boolean;

  constructor(
    message: string,
    code?: number | string,
    causeCode?: string,
    cause?: unknown,
    authenticationError = false,
  ) {
    super(message, { cause });
    this.name = "SynologyClientError";
    this.code = code;
    this.causeCode = causeCode;
    this.authenticationError = authenticationError;
  }
}

const supportedApiVersions = new Set([
  "6.0",
  "6.0.1",
  "6.0.2",
  "6.0.3",
  "6.1",
  "6.1.1",
  "6.1.2",
  "6.1.3",
  "6.1.4",
  "6.1.5",
  "6.1.6",
  "6.1.7",
  "6.2.1",
  "6.2.2",
  "7.0",
  "7.1",
  "7.2",
]);

export function resolveApiVersion(configuredVersion: string): string {
  if (configuredVersion.startsWith("5.")) {
    throw new Error(
      "DSM 5 is no longer supported by the Synology API definitions. Select DSM 6 or newer; the saved DSM 5 setting was not changed.",
    );
  }
  if (configuredVersion === "7.x.x") {
    return "7.2";
  }
  if (configuredVersion === "6.2.3" || configuredVersion === "6.2") {
    return "6.2.2";
  }
  if (!supportedApiVersions.has(configuredVersion)) {
    throw new Error(
      `DSM API version ${configuredVersion} is not supported by syno@3.1.0. Choose a listed DSM 6 or DSM 7 version.`,
    );
  }
  return configuredVersion;
}

export function toBuffer(value: unknown): Buffer | undefined {
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return Buffer.from(value);
  }
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
}

export function createSynologyClient(
  options: SynologyClientOptions,
): SynologyClientHandle {
  const totp = createTotp(options.twoFactorEnabled, options.twoFactorSecret);
  const config: SynoConfig = {
    account: options.account,
    passwd: options.passwd,
    host: options.host,
    port: options.port,
    protocol: options.protocol,
    apiVersion: options.apiVersion,
    ignoreCertificateErrors: false,
    followRedirects: true,
  };
  const client = new Syno(config);
  const dispatcher = new Agent({
    connect: { rejectUnauthorized: !options.ignoreCertificateErrors },
  });
  const auth = client.auth as unknown as AuthInternals;
  const sharedHost = auth.syno;
  sharedHost.request = (url, init) =>
    fetch(url, {
      ...init,
      dispatcher,
      redirect: "follow",
    });

  const originalLogin = auth.login.bind(client.auth);
  const logins = new Map<
    string,
    Promise<{
      sid: string;
    }>
  >();
  auth.login = (sessionName) => {
    const pendingLogin = logins.get(sessionName);
    if (pendingLogin) {
      return pendingLogin;
    }
    const login = (async () => {
      sharedHost.otpCode = totp?.generate();
      try {
        return await originalLogin(sessionName);
      } catch (error) {
        throw normalizeSynologyError(error, true);
      } finally {
        sharedHost.otpCode = undefined;
      }
    })();
    logins.set(sessionName, login);
    void login
      .finally(() => {
        if (logins.get(sessionName) === login) {
          logins.delete(sessionName);
        }
      })
      .catch(() => undefined);
    return login;
  };

  return {
    client,
    close: () => dispatcher.destroy(new Error("Synology adapter stopped")),
  };
}

/**
 * Calls a Hyper Backup Core API method using the client's authenticated session.
 *
 * @param client Authenticated Synology client.
 * @param method Read-only Hyper Backup method.
 * @param params Additional API parameters.
 */
export async function callHyperBackup(
  client: Syno,
  method: "list" | "status",
  params: Record<string, string> = {},
): Promise<unknown> {
  const auth = client.auth as unknown as AuthInternals;
  const { sid } = await auth.login("Core");
  const body = new URLSearchParams({
    api: "SYNO.Backup.Task",
    version: "1",
    method,
    ...params,
    _sid: sid,
  });
  const url = `${client.protocol}://${client.host}:${client.port}/webapi/entry.cgi`;
  const response = await auth.syno.request(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    throw normalizeSynologyError(
      new Error(`Hyper Backup request failed with HTTP ${response.status}`),
    );
  }
  const payload: unknown = await response.json();
  if (!isRecord(payload)) {
    throw new SynologyClientError("Hyper Backup returned an invalid response");
  }
  if (payload.success !== true) {
    const apiError = isRecord(payload.error) ? payload.error : {};
    const code = typeof apiError.code === "number" ? apiError.code : undefined;
    throw new SynologyClientError(
      code === 102 || code === 103 || code === 104
        ? `Hyper Backup API is unavailable (DSM error ${code})`
        : `Hyper Backup request failed${code === undefined ? "" : ` (DSM error ${code})`}`,
      code,
    );
  }
  if (!isRecord(payload.data)) {
    throw new SynologyClientError("Hyper Backup returned invalid data");
  }
  return payload.data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function callSynology(
  client: Syno,
  api: StationApi,
  method: string,
  params?: Record<string, unknown> | null,
): Promise<unknown> {
  const station = client[api] as unknown as Station;
  const resolvedMethod = methodAliases[api]?.[method] ?? method;
  try {
    return await station.call(resolvedMethod, params ?? undefined);
  } catch (error) {
    const normalized = normalizeSynologyError(error);
    if (normalized.code === 106 || normalized.code === 107) {
      delete client.sessions[station.sessionName];
    }
    throw normalized;
  }
}

export function normalizeSynologyError(
  error: unknown,
  authenticationError = false,
): SynologyClientError {
  if (error instanceof SynologyClientError) {
    return error;
  }
  const source = asErrorRecord(error);
  const code =
    typeof source.code === "number" || typeof source.code === "string"
      ? source.code
      : undefined;
  const causeCode =
    typeof source.causeCode === "string"
      ? source.causeCode
      : typeof asErrorRecord(source.cause).code === "string"
        ? String(asErrorRecord(source.cause).code)
        : undefined;
  let message = source.message;
  if (authenticationError && code === 400) {
    message = "Synology authentication failed: check the username and password";
  } else if (authenticationError && code === 403) {
    message = "Synology two-factor authentication is required";
  } else if (authenticationError && code === 404) {
    message = "Synology rejected the two-factor authentication code";
  } else if (code === 106) {
    message = "Synology session expired";
  } else if (code === 107) {
    message = "Synology session was interrupted by another login";
  } else if (typeof code === "number" && code >= 400 && code < 600) {
    message = `Synology HTTP request failed with status ${code}: ${message}`;
  } else if (causeCode) {
    message = `Synology network request failed (${causeCode}): ${message}`;
  }
  return new SynologyClientError(
    message,
    code ?? causeCode,
    causeCode,
    error,
    authenticationError,
  );
}

function createTotp(
  enabled: boolean,
  secret: string | undefined,
): OTPAuth.TOTP | undefined {
  if (!enabled) {
    return undefined;
  }
  const normalizedSecret = secret?.replace(/\s+/g, "").toUpperCase();
  if (!normalizedSecret) {
    throw new Error(
      "Two-factor authentication is enabled but its secret is missing",
    );
  }
  try {
    return new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(normalizedSecret),
    });
  } catch {
    throw new Error("Two-factor authentication secret is not valid Base32");
  }
}

function asErrorRecord(error: unknown): {
  code?: number | string;
  message: string;
  cause?: unknown;
  causeCode?: string;
} {
  if (error instanceof Error) {
    const cause = error.cause;
    const record = error as Error & { code?: number | string };
    return {
      code: record.code,
      message: error.message,
      cause,
      causeCode:
        typeof (cause as { code?: unknown } | undefined)?.code === "string"
          ? String((cause as { code: string }).code)
          : undefined,
    };
  }
  return { message: String(error) };
}
