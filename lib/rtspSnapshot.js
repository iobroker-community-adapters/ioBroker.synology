"use strict";

function getCameraCodec(camera, codecNames) {
  return (
    camera.videoType ||
    camera.detailInfo?.camVideoType ||
    codecNames[camera.videoCodec] ||
    "Unknown"
  );
}

function isH265(codec) {
  return /^(h\.265|h265|hevc)$/i.test(String(codec).trim());
}

function createKeyedQueue() {
  const queues = new Map();
  return (key, task) => {
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

function createRtspUrl(camera, host) {
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

module.exports = { createKeyedQueue, createRtspUrl, getCameraCodec, isH265 };
