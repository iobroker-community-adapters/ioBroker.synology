const cameraStatusLabels: Record<string, string> = {
  1: "Normal",
  2: "Deleted",
  3: "Disconnected",
  4: "Unavailable",
  5: "Ready",
  6: "Inaccessible",
  7: "Disabled",
  8: "Unrecognized",
  9: "Setting",
};

interface CameraStatusData {
  camStatus?: string | number;
  statusId?: string | number;
  status?: string | number;
}

/** Resolve a camera's display status without confusing it with generic status fields. */
/** @param camera Camera-list response item. */
export function getCameraStatus(camera: CameraStatusData): string | undefined {
  if (typeof camera.status === "string") {
    return camera.status;
  }
  const statusId = camera.camStatus ?? camera.statusId;
  if (statusId === undefined) {
    return camera.status === undefined
      ? undefined
      : `Unknown (${camera.status})`;
  }
  return (
    cameraStatusLabels[String(statusId)] ??
    (typeof statusId === "string" ? statusId : `Unknown (${statusId})`)
  );
}
