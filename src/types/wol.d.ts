declare module "wol" {
  interface WakeOptions {
    address?: string;
    port?: number;
  }

  type WakeCallback = (error: Error | null, result?: boolean) => void;

  export function wake(mac: string, callback?: WakeCallback): Promise<boolean>;
  export function wake(
    mac: string,
    options?: WakeOptions,
    callback?: WakeCallback,
  ): Promise<boolean>;
  export function createMagicPacket(mac: string): Buffer;
}
