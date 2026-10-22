"use strict";

/** Session data used to authenticate a Surveillance Station snapshot request. */
interface SurveillanceSession {
  /** Surveillance Station session identifier. */
  _sid?: string;
}

/** Connection details and Surveillance Station session exposed by the Synology client. */
interface SynoSnapshotClient {
  protocol: string;
  host: string;
  port: string | number;
  sessions: { SurveillanceStation?: SurveillanceSession | string };
}

/**
 * Builds a Surveillance Station API URL for a camera snapshot.
 *
 * @param syno Synology client connection and session information.
 * @param cameraId Camera identifier requested by the snapshot API.
 */
function createSnapshotLink(
  syno: SynoSnapshotClient,
  cameraId: string | number,
): string {
  const session = syno.sessions.SurveillanceStation;
  const sid =
    session && typeof session === "object"
      ? (session._sid ?? "")
      : typeof session === "string"
        ? session
        : "";
  return `${syno.protocol}://${syno.host}:${syno.port}/webapi/entry.cgi?api=SYNO.SurveillanceStation.Camera&method=GetSnapshot&version=7&cameraId=${cameraId}&_sid=${sid}`;
}

export { createSnapshotLink };
