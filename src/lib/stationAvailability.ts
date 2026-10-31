export function isUnavailableStationProbeError(
  api: string,
  method: string,
  errorCode: number | string | undefined,
): boolean {
  return (
    errorCode === 102 &&
    api !== "dsm" &&
    (method === "getInfo" || (api === "dtv" && method === "GetInfoTuner"))
  );
}
