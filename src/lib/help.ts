"use strict";

/**
 * The answer of `help`: what the instance answers, written for an AI agent
 * (e.g. ioBroker.pi-agent) and for script authors. Keep it in sync with the
 * message handler in main.ts and the README.
 */

/** A command of the message handler; `write`: it has an effect */
interface HelpCommand {
  command: string;
  write: boolean;
}

/** The commands the message handler answers */
const COMMANDS: HelpCommand[] = [
  { command: "help", write: false },
  { command: "getSnapshot", write: false },
];

const HELP = `ioBroker.synology: reads and controls a Synology NAS over the DSM API (DSM 6 and 7): system, CPU, memory,
disks with SMART, volumes, Hyper Backup, File Station, Download Station, Audio Station, Video Station and Surveillance
Station with its cameras. Reboot and shutdown go over SSH, wake over Wake on LAN. An agent can read the state of the
NAS, take a snapshot of a Surveillance Station camera, call any method of the DSM API and control the stations.
Commands written to states are ignored until the first poll after the start is done.

Commands (sendTo synology.0):
- getSnapshot {camId}: a snapshot of a Surveillance Station camera (camId = its number, the state
  SurveillanceStation.cameras.<name>.id). Answer: the path of the JPEG on the ioBroker host
  (iobroker-data/synology_0/snapshotCam_<camId>.jpg), or false if there is no picture. The same picture is in the
  ioBroker file synology.0/snapshotCam_<camId>.jpg (read it as a file to look at it). H.265 cameras are taken
  with ffmpeg from the RTSP stream. No answer without camId.
- help: this text and the list of commands with their write flag.

States (synology.0.*):
- info.connection: connected to the NAS.
- DiskStationManager.info.* (model, version, temperature, uptime, cpu_load and memory_usage in % ...),
  DiskStationManager.hdd_info.<disk>.* (with SMART values), DiskStationManager.vol_info.<volume>.* (status,
  total_size, used_size, free_size in GB, used in %).
- HyperBackup.taskCount, HyperBackup.listTasks (JSON), HyperBackup.tasks.<id>.* (status, last and next backup,
  last result): read only.
- SurveillanceStation.cameras.<name>.*: id, model, status, recStatus, videoCodec, linkSnapshot (a URL with the
  session of the adapter), enabled (writable: true / false enables or disables the camera);
  SurveillanceStation.HomeMode.status_on (writable: switches the Home Mode); SurveillanceStation.getSnapshotCamera
  (write a camera number: stores a snapshot like getSnapshot).
- <Station>.sendMethod for DiskStationManager, FileStation, DownloadStation, AudioStation, VideoStation and
  SurveillanceStation: write a JSON {"method": "<method>", "params": {...}} (ack false), e.g.
  {"method": "getInfo", "params": {}}; the method names are those of the Synology API definitions of the
  library syno (e.g. getInfo, listCameras). The answer is written into the same state as JSON with ack true.
  It can call ANY method, also ones that delete or change something.
- commands.reboot (true: reboots the NAS), commands.shutdown (true: shuts it down), commands.wake (true: Wake on
  LAN with the MAC address of the settings).
- DownloadStation: activeTask, listTasks (JSON), add_url_download (a URL or magnet link), add_hash_download (a
  hash), folder (the destination for the next download), pause_task / resume_task (a task id, e.g. dbid_170 or
  170, or "all"), shedule_enabled / shedule_emule_enabled.
- FileStation.sharing: create (a path or JSON {path, password, date_expired ...}: creates a share link, the link in
  last_url), delete (the id of a link), clear_invalid (removes expired and broken links).
- AudioStation.players.<player>.*: play, pause, stop, next, prev (true), volume and seek (0-100), repeat (none,
  all, one), shuffle, play_folder (e.g. dir_5816), play_track (e.g. music_120847), current_play (number in the
  playlist), clearPlaylist.

How to talk to the user:
- Name cameras, disks, volumes and players by their names; sizes in GB or TB, times in local time.
- Snapshots: say what the picture shows (people, vehicles, animals, an open door or gate, light and weather);
  pictures of cameras are private: do not send them to other people (messenger, e-mail) or to another adapter
  unless the user asked for exactly that.
- commands.reboot and commands.shutdown: only on the user's explicit request, and ask for confirmation first
  (the NAS and everything that runs on it are gone until it is back or switched on again).
- sendMethod: read methods (get..., list...) are fine; a method that changes, deletes or moves something only on
  the user's explicit request. Disabling a camera, switching the Home Mode, deleting share links and adding
  downloads: only on the user's request.`;

export { COMMANDS, HELP };
