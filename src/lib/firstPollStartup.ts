/** A first-poll task identified by its adapter API key. */
export interface FirstPollApiTask {
  /** Adapter API key used by the Synology client. */
  api: string;
}

export type FirstPollTask = FirstPollApiTask | ((...args: never[]) => unknown);

const stationNames: Readonly<Record<string, string>> = {
  dsm: "DiskStationManager",
  fs: "FileStation",
  dl: "DownloadStation",
  as: "AudioStation",
  vs: "VideoStation",
  dtv: "VideoStation",
  ss: "SurveillanceStation",
};

/**
 * Determine whether the next active request opens a station session for the first time.
 *
 * @param tasks Ordered first-poll API tasks.
 * @param currentIndex Index of the request that just completed.
 * @param isActive Whether a task is configured and installed. The completed task is counted as visited even if its probe just marked it unavailable.
 */
export function needsFirstPollSessionDelay(
  tasks: readonly FirstPollTask[],
  currentIndex: number,
  isActive: (task: FirstPollTask) => boolean,
): boolean {
  const currentTask = tasks[currentIndex];
  if (!currentTask || typeof currentTask === "function") {
    return false;
  }

  const visitedSessions = new Set<string>();
  for (let index = 0; index <= currentIndex; index++) {
    const task = tasks[index];
    if (
      !task ||
      typeof task === "function" ||
      (index !== currentIndex && !isActive(task))
    ) {
      continue;
    }
    const session = stationNames[task.api];
    if (session) {
      visitedSessions.add(session);
    }
  }

  for (let index = currentIndex + 1; index < tasks.length; index++) {
    const nextTask = tasks[index];
    if (!nextTask || typeof nextTask === "function" || !isActive(nextTask)) {
      continue;
    }
    const nextSession = stationNames[nextTask.api];
    return !!nextSession && !visitedSessions.has(nextSession);
  }

  return false;
}
