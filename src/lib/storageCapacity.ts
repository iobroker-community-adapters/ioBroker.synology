const bytesPerGiB = 1024 ** 3;

/**
 * Calculates remaining volume capacity in GiB.
 *
 * @param totalSize Total volume capacity in bytes.
 * @param usedSize Used volume capacity in bytes.
 */
export function calculateFreeSize(totalSize: number, usedSize: number): number {
  return Number(((totalSize - usedSize) / bytesPerGiB).toFixed(2));
}
