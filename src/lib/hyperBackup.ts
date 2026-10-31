/** DSM's required JSON-array encoding for optional Hyper Backup status fields. */
export const HYPER_BACKUP_STATUS_ADDITIONAL = JSON.stringify([
  "last_bkp_time",
  "next_bkp_time",
  "last_bkp_result",
  "last_bkp_progress",
]);

/** A read-only Hyper Backup task status exposed by DSM. */
export interface HyperBackupTask {
  /** Stable DSM task identifier. */
  id: string;
  /** User-configured task name, or the identifier when absent. */
  name: string;
  /** Last backup time as returned by DSM. */
  last_bkp_time?: unknown;
  /** Next scheduled backup time as returned by DSM. */
  next_bkp_time?: unknown;
  /** Current task status reported by DSM. */
  status?: unknown;
  /** Current task state reported by DSM. */
  state?: unknown;
  /** Current backup progress reported by DSM. */
  progress?: unknown;
  /** Result of the most recent backup, when reported by DSM. */
  last_bkp_result?: unknown;
  /** Error from the most recent backup, when reported by DSM. */
  last_bkp_error?: unknown;
  /** DSM error code from the most recent backup, when reported. */
  last_bkp_error_code?: unknown;
  /** Progress details of the last backup, decoded from DSM's JSON string. */
  last_bkp_progress?: unknown;
}

export const HYPER_BACKUP_STATUS_FIELDS = [
  "status",
  "state",
  "progress",
  "last_bkp_time",
  "next_bkp_time",
  "last_bkp_result",
  "last_bkp_error",
  "last_bkp_error_code",
  "last_bkp_progress",
] as const;

export function hasRecognizedHyperBackupStatus(value: unknown): boolean {
  return (
    isRecord(value) &&
    HYPER_BACKUP_STATUS_FIELDS.some((field) => Object.hasOwn(value, field))
  );
}

export interface HyperBackupStatusFetchResult {
  status?: Record<string, unknown>;
  errors: Array<{ source: "live" | "history"; error: unknown }>;
}

export async function fetchHyperBackupTaskStatus(
  taskId: string,
  request: (params: Record<string, string>) => Promise<unknown>,
): Promise<HyperBackupStatusFetchResult> {
  const merged: Record<string, unknown> = {};
  let live: Record<string, unknown> = {};
  const errors: HyperBackupStatusFetchResult["errors"] = [];

  try {
    const response = await request({ task_id: taskId });
    if (!isRecord(response) || !hasRecognizedHyperBackupStatus(response)) {
      throw new Error("Hyper Backup returned no recognized live status fields");
    }
    live = response;
    Object.assign(merged, live);
  } catch (error) {
    errors.push({ source: "live", error });
  }

  try {
    const response = await request({
      task_id: taskId,
      blOnline: "false",
      additional: HYPER_BACKUP_STATUS_ADDITIONAL,
    });
    if (!hasRecognizedHyperBackupStatus(response)) {
      throw new Error("Hyper Backup returned no recognized result fields");
    }
    Object.assign(merged, response, live);
  } catch (error) {
    errors.push({ source: "history", error });
  }

  return {
    ...(Object.keys(merged).length > 0 ? { status: merged } : {}),
    errors,
  };
}

export const HYPER_BACKUP_TASK_STATE_NAMES: Record<string, string> = {
  id: "Task ID",
  name: "Task name",
  status: "Backup status",
  state: "Task state",
  progress: "Current backup progress",
  last_bkp_time: "Last backup time",
  next_bkp_time: "Next scheduled backup",
  last_bkp_result: "Last backup result",
  last_bkp_error: "Last backup error",
  last_bkp_error_code: "Last backup error code",
  last_bkp_progress: "Last backup progress details",
};

export const HYPER_BACKUP_TASK_FIELDS = [
  "name",
  "status",
  "state",
  "progress",
  "last_bkp_time",
  "next_bkp_time",
  "last_bkp_result",
  "last_bkp_error",
  "last_bkp_error_code",
  "last_bkp_progress",
] as const;

export interface HyperBackupTaskState {
  id: string;
  name: string;
  value: unknown;
  type: "string" | "number" | "boolean";
  role: string;
}

export function normalizeHyperBackupObjectId(
  objectId: string,
  namespace: string,
): string | undefined {
  const prefix = `${namespace}.`;
  if (!objectId.startsWith(prefix)) {
    return undefined;
  }
  const relativeId = objectId.slice(prefix.length);
  return relativeId.startsWith("HyperBackup.tasks.") ? relativeId : undefined;
}

export function hyperBackupTaskChannelId(taskId: string): string {
  const segment = /^\d+$/.test(taskId)
    ? taskId
    : `id_${Array.from({ length: taskId.length }, (_, index) =>
        taskId.charCodeAt(index).toString(16).padStart(4, "0"),
      ).join("")}`;
  return `HyperBackup.tasks.${segment}`;
}

function hasUsableTaskId(task: Record<string, unknown>): boolean {
  const id = task.task_id ?? task.id;
  return typeof id === "string"
    ? id.trim().length > 0
    : typeof id === "number" && Number.isFinite(id);
}

export function planStaleHyperBackupChannels(
  existingChannelIds: string[],
  currentChannelIds: string[],
): string[] {
  const current = new Set(currentChannelIds);
  return existingChannelIds.filter(
    (id) => id.startsWith("HyperBackup.tasks.") && !current.has(id),
  );
}

export function planStaleHyperBackupStates(
  existingStateIds: string[],
  currentChannelIds: string[],
  expectedStateIds: Set<string>,
  statusFailures: Set<string>,
): string[] {
  return existingStateIds.filter((id) => {
    const channelId = currentChannelIds.find((channel) =>
      id.startsWith(`${channel}.`),
    );
    const taskId = channelId?.slice("HyperBackup.tasks.".length);
    return (
      channelId !== undefined &&
      !expectedStateIds.has(id) &&
      !(taskId !== undefined && statusFailures.has(taskId))
    );
  });
}

export function projectHyperBackupTaskStates(
  task: HyperBackupTask,
): HyperBackupTaskState[] {
  return HYPER_BACKUP_TASK_FIELDS.flatMap((field) => {
    if (!Object.hasOwn(task, field)) {
      return [];
    }
    const value = task[field as keyof HyperBackupTask];
    if (value === null || value === undefined) {
      return [];
    }
    const structured = typeof value === "object";
    const type = structured ? "string" : typeof value;
    const numericValue = typeof value === "number";
    const role =
      field === "name"
        ? "info.name"
        : structured
          ? "json"
          : field.endsWith("_time")
            ? "date"
            : (field === "progress" || field === "last_bkp_error_code") &&
                numericValue
              ? "value"
              : field === "status" ||
                  field === "state" ||
                  field === "last_bkp_result" ||
                  field === "last_bkp_error"
                ? "text"
                : "text";
    return [
      {
        id: field,
        name: HYPER_BACKUP_TASK_STATE_NAMES[field],
        value: structured ? JSON.stringify(value) : value,
        type: type === "number" || type === "boolean" ? type : "string",
        role,
      },
    ];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Extracts task records from a Hyper Backup list response.
 *
 * @param response Raw response returned by `SYNO.Backup.Task.list`.
 */
export function parseHyperBackupTaskList(
  response: unknown,
): Record<string, unknown>[] | undefined {
  if (!isRecord(response)) {
    return undefined;
  }
  const tasks = response.task_list ?? response.tasks;
  return Array.isArray(tasks) &&
    tasks.every((task) => isRecord(task) && hasUsableTaskId(task))
    ? tasks
    : undefined;
}

export function getHyperBackupTaskList(
  response: unknown,
): Record<string, unknown>[] {
  return parseHyperBackupTaskList(response) ?? [];
}

/**
 * Maps DSM task metadata and their separately fetched status responses.
 *
 * @param tasks Task records returned by `SYNO.Backup.Task.list`.
 * @param statuses Status responses keyed by task ID.
 */
export function mapHyperBackupTasks(
  tasks: Record<string, unknown>[],
  statuses: Map<string, unknown>,
): HyperBackupTask[] {
  return tasks.flatMap((task) => {
    if (!hasUsableTaskId(task)) {
      return [];
    }
    const id = String(task.task_id ?? task.id);
    const rawName = task.task_name ?? task.name;
    const status = statuses.get(id);
    const result: HyperBackupTask = {
      id,
      name: typeof rawName === "string" && rawName.length > 0 ? rawName : id,
    };
    for (const field of ["status", "state", "progress"] as const) {
      if (Object.hasOwn(task, field)) {
        result[field] = task[field];
      }
    }
    if (isRecord(status)) {
      for (const field of HYPER_BACKUP_STATUS_FIELDS) {
        if (Object.hasOwn(status, field)) {
          const value = status[field];
          if (field === "last_bkp_progress" && typeof value === "string") {
            try {
              result[field] = JSON.parse(value) as unknown;
            } catch {
              result[field] = value;
            }
          } else {
            result[field] = value;
          }
        }
      }
    }
    return [result];
  });
}
