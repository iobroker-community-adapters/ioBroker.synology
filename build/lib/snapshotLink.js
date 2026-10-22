"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSnapshotLink = createSnapshotLink;
/**
 * Builds a Surveillance Station API URL for a camera snapshot.
 *
 * @param syno Synology client connection and session information.
 * @param cameraId Camera identifier requested by the snapshot API.
 */
function createSnapshotLink(syno, cameraId) {
    const session = syno.sessions.SurveillanceStation;
    const sid = session && typeof session === "object"
        ? (session._sid ?? "")
        : typeof session === "string"
            ? session
            : "";
    return `${syno.protocol}://${syno.host}:${syno.port}/webapi/entry.cgi?api=SYNO.SurveillanceStation.Camera&method=GetSnapshot&version=7&cameraId=${cameraId}&_sid=${sid}`;
}
//# sourceMappingURL=snapshotLink.js.map