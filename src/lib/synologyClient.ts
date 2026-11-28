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
  sleep: (milliseconds: number) => Promise<void>;
}

interface SynoRequestHost {
  request: (url: string, init: RequestInit) => Promise<UndiciResponse>;
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
      `DSM API version ${configuredVersion} is not supported by syno@3.2.0. Choose a listed DSM 6 or DSM 7 version.`,
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
  const logins = new Map<string, Promise<{ sid: string }>>();
  const otpCodes = new Map<string, string>();
  let lastOtpCode: string | undefined;
  let loginQueue = Promise.resolve();
  const config: SynoConfig = {
    account: options.account,
    passwd: options.passwd,
    host: options.host,
    port: options.port,
    protocol: options.protocol,
    apiVersion: options.apiVersion,
    ignoreCertificateErrors: false,
    followRedirects: true,
    otpCode: totp
      ? async (sessionName) => {
          const otpCode = await waitForFreshTotpCode(
            totp,
            lastOtpCode,
            options.sleep,
          );
          lastOtpCode = otpCode;
          otpCodes.set(sessionName, otpCode);
          return otpCode;
        }
      : undefined,
  };
  const client = new Syno(config);
  const dispatcher = new Agent({
    connect: { rejectUnauthorized: !options.ignoreCertificateErrors },
  });
  const requestHost = getSynoRequestHost(client);
  requestHost.request = (url, init) =>
    fetch(url, {
      ...init,
      dispatcher,
      redirect: "follow",
    });

  const originalLogin = client.auth.login.bind(client.auth);
  client.auth.login = (sessionName) => {
    const pendingLogin = logins.get(sessionName);
    if (pendingLogin) {
      return pendingLogin;
    }
    /**
     * Performs a serialized login with a fresh TOTP code.
     *
     * @returns The authenticated session ID.
     */
    async function performLogin(): Promise<{ sid: string }> {
      let retriedTwoFactorLogin = false;
      try {
        while (true) {
          try {
            return await originalLogin(sessionName);
          } catch (error) {
            const normalized = normalizeSynologyError(error, true);
            if (
              totp &&
              normalized.authenticationError &&
              normalized.code === 404 &&
              otpCodes.has(sessionName) &&
              !retriedTwoFactorLogin
            ) {
              retriedTwoFactorLogin = true;
              continue;
            }
            throw normalized;
          }
        }
      } finally {
        otpCodes.delete(sessionName);
      }
    }
    const login = totp ? loginQueue.then(performLogin) : performLogin();
    if (totp) {
      loginQueue = login.then(
        () => undefined,
        () => undefined,
      );
    }
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
 * Keeps Syno requests and custom Hyper Backup requests on the same transport.
 *
 * @param client Syno client whose shared request host is used.
 */
function getSynoRequestHost(client: Syno): SynoRequestHost {
  return (client.auth as unknown as { syno: SynoRequestHost }).syno;
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
  const sid =
    client.sessions?.Core?._sid ?? (await client.auth.login("Core")).sid;
  const requestHost = getSynoRequestHost(client);
  const body = new URLSearchParams({
    api: "SYNO.Backup.Task",
    version: "1",
    method,
    ...params,
    _sid: sid,
  });
  const url = `${client.protocol}://${client.host}:${client.port}/webapi/entry.cgi`;
  const response = await requestHost.request(url, {
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
    if (code === 106 || code === 107) {
      delete client.sessions?.Core;
    }
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

/**
 * Waits until a TOTP differs from the most recently accepted code.
 *
 * @param totp Configured TOTP generator.
 * @param previousCode Last successfully used code.
 * @param sleep Delay function, bound to the adapter lifecycle.
 */
export async function waitForFreshTotpCode(
  totp: OTPAuth.TOTP,
  previousCode: string | undefined,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<string> {
  let code = totp.generate();
  while (code === previousCode) {
    await sleep(totp.remaining() + 25);
    code = totp.generate();
  }
  return code;
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
