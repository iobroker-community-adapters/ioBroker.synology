"use strict";

/** Camera fields used to select and construct an RTSP snapshot stream. */
export interface SnapshotCamera {
  /** Camera identifier used in the Synology stream URL. */
  id: string | number;
  /** Codec name reported directly by the camera. */
  videoType?: string | null;
  /** Additional camera details returned by Surveillance Station. */
  detailInfo?: {
    /** Codec name reported in the detailed camera information. */
    camVideoType?: string | null;
  } | null;
  /** Numeric or textual codec identifier returned by the API. */
  videoCodec?: string | number | null;
  /** RTSP-over-HTTP URL containing the stream key. */
  linkRtspOverHttpPath?: string | null;
  /** RTSP URL containing the stream credentials. */
  linkRtspPath?: string | null;
}

/**
 * Selects the first available codec name from the camera metadata.
 *
 * @param camera Camera metadata returned by Surveillance Station.
 * @param codecNames Names indexed by the API's codec identifiers.
 */
function getCameraCodec(
  camera: Pick<SnapshotCamera, "videoType" | "detailInfo" | "videoCodec">,
  codecNames: Record<string, string | undefined>,
): string {
  return (
    camera.videoType ||
    camera.detailInfo?.camVideoType ||
    (camera.videoCodec == null
      ? undefined
      : codecNames[String(camera.videoCodec)]) ||
    "Unknown"
  );
}

/**
 * Checks whether a codec name identifies H.265/HEVC video.
 *
 * @param codec Codec name or value to inspect.
 */
function isH265(codec: unknown): boolean {
  return /^(h\.265|h265|hevc)$/i.test(String(codec).trim());
}

/** Creates a per-key queue so tasks for each camera run in order. */
function createKeyedQueue<K>() {
  const queues = new Map<K, Promise<unknown>>();
  /**
   * Enqueues a task after earlier tasks for the same key.
   *
   * @param key Queue key used to serialize related tasks.
   * @param task Work to run after earlier tasks for this key.
   */
  return function enqueue<T>(key: K, task: () => T | Promise<T>): Promise<T> {
    const previous = queues.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(task);
    queues.set(key, current);
    current.then(
      () => {
        if (queues.get(key) === current) {
          queues.delete(key);
        }
      },
      () => {
        if (queues.get(key) === current) {
          queues.delete(key);
        }
      },
    );
    return current;
  };
}

/**
 * Builds the authenticated RTSP URL used to capture a camera snapshot.
 *
 * @param camera Camera metadata containing the RTSP URL and identifier.
 * @param host Synology device host used for the stream connection.
 */
function createRtspUrl(camera: SnapshotCamera, host: string): string {
  const streamPath = camera.linkRtspOverHttpPath;
  if (!streamPath) {
    throw new Error("RTSP-over-HTTP path is not available yet");
  }

  const streamKey = new URL(streamPath).searchParams.get("StmKey");
  if (!streamKey) {
    throw new Error("Synology did not provide an RTSP stream key");
  }

  if (!camera.linkRtspPath) {
    throw new Error(
      "Synology did not provide an RTSP path with streaming credentials",
    );
  }
  const rtspUrl = new URL(camera.linkRtspPath);
  if (!rtspUrl.username || !rtspUrl.password) {
    throw new Error("Synology did not provide RTSP streaming credentials");
  }

  const credentials = `${rtspUrl.username}:${rtspUrl.password}`;
  return `rtsp://${credentials}@${host}:554/Sms=${camera.id}.unicast`;
}

export { createKeyedQueue, createRtspUrl, getCameraCodec, isH265 };
