"use strict";
// @ts-check

import * as adapterCore from "@iobroker/adapter-core";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import moment from "moment";
import * as path from "node:path";
import SimpleSSH from "simple-ssh";
import type { Syno } from "syno";
import * as wol from "wol";
import { createSnapshotLink } from "./lib/snapshotLink.js";
import {
  createKeyedQueue,
  createRtspUrl,
  getCameraCodec,
  isH265,
} from "./lib/rtspSnapshot.js";
import { parseSmartAttributes } from "./lib/smartAttributes.js";
import { filterSshStderr } from "./lib/sshOutput.js";
import {
  callSynology,
  createSynologyClient,
  resolveApiVersion,
  SynologyClientError,
  toBuffer,
} from "./lib/synologyClient.js";

const utils = adapterCore as typeof adapterCore & {
  adapter(options: ioBroker.AdapterOptions): ioBroker.Adapter;
};

let adapter: ioBroker.Adapter;
let syno: Syno | null = null;
let closeSynologyClient: (() => Promise<void>) | undefined;
let smartPollInProgress = false;
let adapterUnloading = false;
let timeOutPoll: ioBroker.Timeout | undefined;
let timeOutReconnect: ioBroker.Timeout | undefined;
let pollTime: number;
let connect = false;
let connectionEstablished = false;
let authenticationFailed = false;
let iteration = 0;
// let queueCmd = null;
let startTime: number;
let endTime: number;
let firstStart = true;
let firstStartInfoStatePromise: Promise<void>;
let slowPollingTime: number;
let dir: string;
let old_states: typeof states;
let timeOut: ioBroker.Timeout | undefined;
// let pathInstance;
const verifiedObjects: Record<string, string> = {};
interface H265Capture {
  done: Promise<void>;
  resolveDone: () => void;
  cancel: () => void;
}
const activeH265Captures = new Set<H265Capture>();
const enqueueH265Snapshot = createKeyedQueue();
const verifiedChannels = new Set<string>();
const smartAttributeMetadata = {
  Temperature_Celsius: {
    role: "value.temperature",
    type: "number",
    unit: "°C",
  },
  Power_On_Hours: { role: "value.interval", type: "number", unit: "h" },
};
let wolTries = 3;
let wolTimer: ioBroker.Timeout | undefined;
const states = {} as AdapterStates;

const stateSS: {
  recStatus: Record<string, string>;
  videoCodec: Record<string, string>;
  camStatus: Record<string, string>;
} = {
  recStatus: {
    0: "None recording schedule",
    1: "Continue recording schedule",
    2: "Motion detect recording schedule",
    3: "Digital input recording schedule",
    4: "Digital input recording schedule",
    5: "Manual recording schedule",
    6: "External",
    7: "Analytics",
  },
  videoCodec: {
    0: "Unknown",
    1: "MJPEG",
    2: "MPEG4",
    3: "H264",
    5: "MXPEG",
    6: "H265",
    7: "H264+",
  },
  camStatus: {
    1: "Normal",
    2: "Deleted",
    3: "Disconnected",
    4: "Unavailable",
    5: "Ready",
    6: "Inaccessible",
    7: "Disabled",
    8: "Unrecognized",
    9: "Setting",
    10: "Server disconnected",
    11: "Migrating",
    12: "Others",
    13: "Storage removed",
    14: "Stopping",
    15: "Connect hist failed",
    16: "Unauthorized",
    17: "RTSP error",
    18: "No video",
  },
};

function startAdapter(
  options: ioBroker.AdapterOptions = {} as ioBroker.AdapterOptions,
): ioBroker.Adapter {
  adapterUnloading = false;
  return (adapter = utils.adapter(
    Object.assign({}, options, {
      systemConfig: true,
      name: "synology",
      ready: main,
      unload: (
        callback: Parameters<NonNullable<ioBroker.AdapterOptions["unload"]>>[0],
      ) => {
        adapterUnloading = true;
        timeOutPoll && adapter.clearTimeout(timeOutPoll);
        timeOutReconnect && adapter.clearTimeout(timeOutReconnect);
        timeOut && adapter.clearTimeout(timeOut);
        try {
          if (wolTimer) {
            adapter.clearTimeout(wolTimer);
            wolTimer = null;
          }
          debug("cleaned everything up...");
        } catch (e) {
          adapter.log.warn(`Error while cleaning up: ${String(e)}`);
        }
        const captures = [...activeH265Captures];
        captures.forEach((capture) => capture.cancel());
        const closeClient = closeSynologyClient?.() ?? Promise.resolve();
        closeSynologyClient = undefined;
        void Promise.allSettled([
          ...captures.map((capture) => capture.done),
          closeClient,
        ]).then(() => callback());
      },
      stateChange: (
        id: Parameters<NonNullable<ioBroker.AdapterOptions["stateChange"]>>[0],
        state: Parameters<
          NonNullable<ioBroker.AdapterOptions["stateChange"]>
        >[1],
      ) => {
        if (
          id &&
          state &&
          !state.ack &&
          firstStart &&
          id.endsWith(".getSnapshotCamera")
        ) {
          warn(
            "Snapshot request ignored: the first start has not completed yet",
          );
          return;
        }
        if (id && state && !state.ack && !firstStart) {
          debug(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
          const ids = id.split(".");
          const name = ids[ids.length - 2].toString();
          const command = ids[ids.length - 1].toString();
          const val = state.val;
          switch (command) {
            case "reboot":
              sendSSH("shutdown -r now", () => {
                warn("System reboot");
                rePollAfterCmd();
              });
              break;
            case "shutdown":
              sendSSH("shutdown -h now", () => {
                warn("System shutdown");
                rePollAfterCmd();
              });
              break;

            case "Browser":
              if (name in states.AudioStation.players) {
                // queueCmd = true;
                Browser(name, val);
              } else {
                error("Browser", `Error player ${name} offline?`);
              }
              break;

            case "play_folder":
              PlayFolder(name, val);
              break;
            case "play_track":
              PlayTrack(name, val);
              break;
            case "song_id":
              PlayTrackId(name, val);
              break;
            case "current_play":
              PlayTrackNum(name, val);
              break;
            case "clearPlaylist":
              clearPlaylist(name);
              break;

            case "stop":
            case "next":
            case "prev":
            case "volume":
            case "seek":
            case "pause":
            case "play":
            case "repeat":
            case "shuffle":
              PlayControl(name, command, val);
              break;

            case "getSnapshotCamera":
              getSnapshotCamera(val);
              break;

            case "add_url_download":
            case "add_hash_download":
              addDownload(command, val);
              break;
            case "shedule_emule_enabled":
            case "shedule_enabled":
              setConfigSchedule(command, val);
              break;
            case "pause_task":
            case "resume_task":
              pauseTask(command, val);
              break;
            case "enabled":
              switchCam(name, command, val);
              break;
            case "status_on":
              send("ss", "switchHomeMode", { on: val });
              break;
            case "sendMethod":
              sendMethod(name, val);
              break;
            case "create":
              if (name === "sharing") {
                CreateSharing(command, val);
              }
              break;
            case "delete":
              if (name === "sharing") {
                DeleteSharing(command, val);
              }
              break;
            case "clear_invalid":
              if (name === "sharing") {
                send("fs", "Clear_invalidSharing", {}, () => {
                  debug("Remove all expired and broken sharing links.");
                });
              }
              break;
            default:
              console.log(name);
          }
        }
        // Wake on LAN command is sent before start
        if (id && state && !state.ack) {
          debug(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
          const ids = id.split(".");
          const name = ids[ids.length - 2].toString();
          const command = ids[ids.length - 1].toString();
          switch (command) {
            case "wake":
              if (adapter.config.mac) {
                debug(`Try to wake on LAN with mac ${adapter.config.mac}`);
                wake(adapter.config.mac);
              }
              break;
            default:
              console.log(name);
          }
        }
      },
      message: (
        obj: Parameters<NonNullable<ioBroker.AdapterOptions["message"]>>[0],
      ) => {
        if (typeof obj === "object" && obj.command) {
          debug(`message ******* ${JSON.stringify(obj)}`);
          if (obj.command === "getSnapshot" && obj.message.camId) {
            getSnapshotCamera(parseInt(obj.message.camId, 10), (res) => {
              obj.callback &&
                adapter.sendTo(obj.from, obj.command, res, obj.callback);
            });
          }
        } else {
          debug(`message x ${obj.command}`);
        }
      },
    }),
  ));
}

function wake(mac: string): void {
  const macRegex = /^(([0-9A-Fa-f]{2}[:-]?){5}[0-9A-Fa-f]{2})$/;
  if (mac && macRegex.test(mac) && mac !== "00:00:00:00:00:00") {
    wol.wake(mac, (err: Error | null, res?: boolean) => {
      wolTries = wolTries - 1;
      if (err) {
        debug(String(err));
        wolTries = 3;
      }
      if (wolTries > 0) {
        wolTimer = adapter.setTimeout(() => {
          wolTimer = null;
          wake(mac);
        }, 750);
      } else if (wolTries === 0) {
        wolTries = 3;
      }
      debug(`Wake on LAN try ${wolTries + 1}: ${res}`);
    });
  } else {
    warn(
      "Failed to wake Synology. Please set valid MAC address in instance settings",
    );
  }
}

interface CameraState {
  [key: string]: unknown;
  id?: number;
  codec?: string;
  linkSnapshot?: string;
  linkMjpegHttpPath?: string;
  linkMulticstPath?: string;
  linkMxpegHttpPath?: string;
  linkRtspOverHttpPath?: string;
  linkRtspPath?: string;
}

type SnapshotResult = string | false;
type SnapshotCallback = (result: SnapshotResult) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return String(value);
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value.toString();
  }
  return JSON.stringify(value) ?? "[unserializable value]";
}

interface DiskState {
  [key: string]: unknown;
  diskno?: string;
  diskPath?: string;
  smart: Record<string, number | string>;
}

interface VolumeState {
  [key: string]: unknown;
}

interface PlayerState {
  [key: string]: unknown;
  online?: boolean;
  playlist_total?: number;
  duration_sec?: number;
  song_id?: number | string;
  playlist?: string;
  Browser?: string;
}

interface RemotePlayerStatus {
  state: string;
  index: number | string;
  position: number;
  playlist_total: number;
  volume: number;
  subplayer_volume: number;
  song: {
    id: number;
    title: string;
    path: string;
    additional: {
      song_tag: Record<string, unknown>;
      song_audio: { bitrate: number; duration: number };
    };
  };
  play_mode: { repeat: string; shuffle: boolean };
}

interface AudioPlaylistResponse {
  songs?: Array<{ id: number | string; title: string; path: string }>;
}

interface ServiceState {
  name: string;
  installed: boolean;
}

interface AdapterStates {
  DiskStationManager: {
    info: Record<string, unknown>;
    hdd_info: Record<string, DiskState>;
    vol_info: Record<string, VolumeState>;
  };
  FileStation: {
    info: Record<string, unknown>;
    sharing: Record<string, unknown>;
  };
  DownloadStation: Record<string, unknown>;
  AudioStation: {
    info: Record<string, unknown>;
    players: Record<string, PlayerState>;
  };
  VideoStation: { info: Record<string, unknown> };
  VideoStation_DTV: { info: Record<string, unknown> };
  SurveillanceStation: {
    info: Record<string, unknown>;
    cameras: Record<string, CameraState>;
    HomeMode: Record<string, unknown>;
  };
  api: Record<string, ServiceState>;
}

Object.assign(states, {
  DiskStationManager: { info: {}, hdd_info: {}, vol_info: {} },
  FileStation: { info: {}, sharing: {} },
  DownloadStation: { info: {} },
  AudioStation: { info: {}, players: {} },
  VideoStation: { info: {} },
  VideoStation_DTV: { info: {} },
  SurveillanceStation: { info: {}, cameras: {}, HomeMode: {} },
  api: {
    dsm: { name: "DiskStationManager", installed: true },
    fs: { name: "FileStation", installed: true },
    dl: { name: "DownloadStation", installed: false },
    as: { name: "AudioStation", installed: false },
    vs: { name: "VideoStation", installed: false },
    dtv: { name: "dtVideoStation_DTV", installed: false },
    ss: { name: "SurveillanceStation", installed: false },
  },
});

type StateValueType = "string" | "number" | "boolean" | "object";
interface StateMetadata {
  name: string;
  role: string;
  type: StateValueType;
  unit?: string;
  min?: string | number;
  max?: string | number;
  states?: ioBroker.StateCommon["states"];
  read?: boolean;
  write?: boolean;
}

const objects: Record<string, StateMetadata> = {
  album: {
    role: "media.album",
    name: "Album",
    type: "string",
    read: true,
    write: false,
  },
  artist: {
    role: "media.artist",
    name: "Artist",
    type: "string",
    read: true,
    write: false,
  },
  audio_show_virtual_library: {
    role: "state",
    name: "Audio show virtual library",
    type: "boolean",
    read: true,
    write: false,
  },
  activeTask: {
    role: "value",
    name: "Number of active downloads",
    type: "number",
    read: true,
    write: false,
  },
  bitrate: {
    role: "media.bitrate",
    name: "Bitrate",
    type: "string",
    unit: "kbps",
    read: true,
    write: false,
  },
  Browser: {
    role: "media.browser",
    name: "AudioStation Browser Files",
    type: "string",
    read: true,
    write: true,
  },
  cameraNumber: {
    role: "state",
    name: "Camera number",
    type: "number",
    read: true,
    write: false,
  },
  capacity: {
    role: "value",
    name: "Capacity",
    type: "number",
    unit: "GB",
    read: true,
    write: false,
  },
  clearPlaylist: {
    role: "button",
    name: "Clear current playlist",
    type: "boolean",
    read: false,
    write: true,
  },
  codec: {
    role: "text",
    name: "Video codec",
    type: "string",
    read: true,
    write: false,
  },
  cover: {
    role: "media.cover",
    name: "Media cover (eg. http://{ip}:8082/{state})",
    type: "string",
    read: true,
    write: false,
  },
  cpu_load: {
    role: "value",
    name: "Cpu load",
    type: "number",
    unit: "%",
    read: true,
    write: false,
  },
  current_duration: {
    role: "media.duration.text",
    name: "Playback duration",
    type: "string",
    read: true,
    write: false,
  },
  current_elapsed: {
    role: "media.elapsed.text",
    name: "Playback elapsed",
    type: "string",
    read: true,
    write: false,
  },
  current_play: {
    role: "media.track",
    name: "Controlling and state current play track number",
    type: "number",
    read: true,
    write: true,
  },
  disable_upnp: {
    role: "state",
    name: "Disable upnp",
    type: "boolean",
    read: true,
    write: false,
  },
  dsd_decode_capability: {
    role: "state",
    name: "DSD decode capability",
    type: "boolean",
    read: true,
    write: false,
  },
  dtv: {
    role: "state",
    name: "DTV",
    type: "boolean",
    read: true,
    write: false,
  },
  dtv_transcode: {
    role: "state",
    name: "DTV transcode",
    type: "boolean",
    read: true,
    write: false,
  },
  duration: {
    role: "media.duration.text",
    name: "Duration track",
    type: "string",
    read: true,
    write: false,
  },
  duration_sec: {
    role: "media.duration",
    name: "Duration track in seconds",
    type: "number",
    read: true,
    write: false,
  },
  ebox_order: {
    role: "state",
    name: "Ebox order",
    type: "number",
    read: true,
    write: false,
  },
  enableVideoRelay: {
    role: "state",
    name: "Enable video relay",
    type: "boolean",
    read: true,
    write: false,
  },
  enable_download: {
    role: "state",
    name: "Enable download",
    type: "boolean",
    read: true,
    write: false,
  },
  enable_equalizer: {
    role: "state",
    name: "Enable equalizer",
    type: "boolean",
    read: true,
    write: false,
  },
  enable_iso_mount: {
    role: "state",
    name: "Enable ISO mount",
    type: "boolean",
    read: true,
    write: false,
  },
  enable_list_usergrp: {
    role: "state",
    name: "Enable list user groups",
    type: "boolean",
    read: true,
    write: false,
  },
  enable_view_google: {
    role: "state",
    name: "Enable view Google",
    type: "boolean",
    read: true,
    write: false,
  },
  enable_view_microsoft: {
    role: "state",
    name: "Enable view Microsoft",
    type: "boolean",
    read: true,
    write: false,
  },
  enable_send_email_attachment: {
    role: "state",
    name: "Enable sending email attachments",
    type: "boolean",
    read: true,
    write: false,
  },
  enable_personal_library: {
    role: "state",
    name: "Enable personal library",
    type: "boolean",
    read: true,
    write: false,
  },
  enable_remote_mount: {
    role: "state",
    name: "Enable remote mount",
    type: "boolean",
    read: true,
    write: false,
  },
  enable_user_home: {
    role: "state",
    name: "User home",
    type: "boolean",
    read: true,
    write: true,
  },
  enabled: {
    role: "state",
    name: "Is enabled",
    type: "boolean",
    read: true,
    write: true,
  },
  favoriteRadio: {
    role: "state",
    name: "Favorite playlist Radio",
    type: "string",
    read: true,
    write: false,
  },
  firstStartCompleted: {
    role: "indicator",
    name: "First start completed",
    type: "boolean",
    read: true,
    write: false,
  },
  fhd_hardware_transcode: {
    role: "state",
    name: "FullHD hardware transcode",
    type: "boolean",
    read: true,
    write: false,
  },
  genre: {
    role: "media.genre",
    name: "Genre",
    type: "string",
    read: true,
    write: false,
  },
  geo_lat: {
    role: "state",
    name: "Geo latitude",
    type: "number",
    read: true,
    write: false,
  },
  geo_lng: {
    role: "state",
    name: "Geo longitude",
    type: "number",
    read: true,
    write: false,
  },
  geo_radius: {
    role: "state",
    name: "Geo radius",
    type: "number",
    read: true,
    write: false,
  },
  hardware_transcode: {
    role: "state",
    name: "Hardware transcode",
    type: "boolean",
    read: true,
    write: false,
  },
  has_music_share: {
    role: "state",
    name: "Has music share",
    type: "boolean",
    read: true,
    write: false,
  },
  id: { role: "state", name: "ID", type: "number", read: true, write: false },
  isLicenseEnough: {
    role: "state",
    name: "Is License Enough",
    type: "number",
    read: true,
    write: false,
  },
  is_dtv_enabled: {
    role: "state",
    name: "Is DTV enabled",
    type: "boolean",
    read: true,
    write: false,
  },
  is_manager: {
    role: "state",
    name: "Is manager",
    type: "boolean",
    read: true,
    write: false,
  },
  is_personal_metadata_key_enabled: {
    role: "state",
    name: "Is personal metadata key enabled",
    type: "boolean",
    read: true,
    write: false,
  },
  is_subtitle_search_enabled: {
    role: "state",
    name: "Is subtitle search enabled",
    type: "boolean",
    read: true,
    write: false,
  },
  is_system_crashed: {
    role: "indicator.error",
    name: "Is system crashed",
    type: "boolean",
    read: true,
    write: false,
  },
  liscenseNumber: {
    role: "value",
    name: "License Number",
    type: "number",
    read: true,
    write: false,
  },
  maxCameraSupport: {
    role: "value",
    name: "Max camera support",
    type: "number",
    read: true,
    write: false,
  },
  memory_size: {
    role: "value",
    name: "Memory size",
    type: "number",
    read: true,
    write: false,
  },
  memory_usage: {
    role: "value",
    name: "Memory usage",
    type: "number",
    unit: "%",
    read: true,
    write: false,
  },
  motionDetected: {
    role: "sensor.motion",
    name: "Motion detected",
    type: "boolean",
    read: true,
    write: false,
  },
  model: {
    role: "info.model",
    name: "Model",
    type: "string",
    read: true,
    write: false,
  },
  next: {
    role: "button.next",
    name: "Controlling playback next",
    type: "boolean",
    read: false,
    write: true,
  },
  notify_on: {
    role: "state",
    name: "Notify on",
    type: "boolean",
    read: true,
    write: false,
  },
  offline_conversion: {
    role: "state",
    name: "Offline conversion",
    type: "boolean",
    read: true,
    write: false,
  },
  onetime_disable_on: {
    role: "state",
    name: "Onetime disable ON",
    type: "boolean",
    read: true,
    write: false,
  },
  onetime_enable_on: {
    role: "state",
    name: "Onetime enable ON",
    type: "boolean",
    read: true,
    write: false,
  },
  online: {
    role: "state",
    name: "Is player online",
    type: "boolean",
    read: true,
    write: false,
  },
  path: {
    role: "media",
    name: "Path track",
    type: "string",
    read: true,
    write: false,
  },
  pause: {
    role: "button.pause",
    name: "Controlling playback pause",
    type: "boolean",
    read: false,
    write: true,
  },
  play: {
    role: "button.play",
    name: "Controlling playback play",
    type: "boolean",
    read: false,
    write: true,
  },
  play_folder: {
    role: "media.add",
    name: "Add tracks from the folder to the playlist",
    type: "string",
    read: true,
    write: true,
  },
  play_track: {
    role: "state",
    name: "Play track by its id",
    type: "string",
    read: true,
    write: true,
  },
  player_name: {
    role: "media",
    name: "Remote player name",
    type: "string",
    read: true,
    write: false,
  },
  playing_queue_max: {
    role: "state",
    name: "Playing queue max",
    type: "number",
    read: true,
    write: false,
  },
  playlist: {
    role: "media.playlist",
    name: "AudioStation playlist",
    type: "string",
    read: true,
    write: true,
  },
  playlist_edit: {
    role: "state",
    name: "Playlist edit",
    type: "boolean",
    read: true,
    write: false,
  },
  playlist_total: {
    role: "media",
    name: "Number of tracks in the playlist",
    type: "number",
    read: true,
    write: false,
  },
  port: {
    role: "info.port",
    name: "Port",
    type: "number",
    read: true,
    write: false,
  },
  prefer_using_html5: {
    role: "state",
    name: "Prefer using HTML5",
    type: "boolean",
    read: true,
    write: false,
  },
  prev: {
    role: "button.prev",
    name: "Controlling playback previous",
    type: "boolean",
    read: false,
    write: true,
  },
  ram: {
    role: "state",
    name: "RAM",
    type: "number",
    unit: "MB",
    read: true,
    write: false,
  },
  remindQuickconnectTunnel: {
    role: "state",
    name: "Remind QuickConnect Tunnel",
    type: "boolean",
    read: true,
    write: false,
  },
  remote_controller: {
    role: "state",
    name: "Remote controller",
    type: "boolean",
    read: true,
    write: false,
  },
  remote_player: {
    role: "state",
    name: "Remote player",
    type: "boolean",
    read: true,
    write: false,
  },
  remux: {
    role: "state",
    name: "Remux",
    type: "boolean",
    read: true,
    write: false,
  },
  renderer: {
    role: "state",
    name: "Renderer",
    type: "boolean",
    read: true,
    write: false,
  },
  repeat: {
    role: "media.mode.repeat",
    name: "Repeat control",
    type: "string",
    read: true,
    write: true,
    states: { none: "Off", all: "All", one: "One" },
  },
  same_subnet: {
    role: "state",
    name: "Same subnet",
    type: "boolean",
    read: true,
    write: false,
  },
  seek: {
    role: "media.seek",
    name: "Controlling playback seek",
    type: "number",
    unit: "%",
    min: 0,
    max: 100,
    read: true,
    write: true,
  },
  serviceVolSize: {
    role: "value",
    name: "Service Volume Size",
    type: "number",
    read: true,
    write: false,
  },
  serial: {
    role: "info.serial",
    name: "Serial number",
    type: "string",
    read: true,
    write: false,
  },
  sharing: {
    role: "state",
    name: "Sharing",
    type: "boolean",
    read: true,
    write: false,
  },
  shuffle: {
    role: "media.mode.shuffle",
    name: "Shuffle control",
    type: "boolean",
    read: true,
    write: true,
  },
  software_transcode: {
    role: "state",
    name: "Software transcode",
    type: "boolean",
    read: true,
    write: false,
  },
  song_id: {
    role: "media.playid",
    name: "Controlling and state current play track id",
    type: "number",
    read: true,
    write: true,
  },
  state_playing: {
    role: "media.state",
    name: "Status Play, stop, or pause",
    type: "string",
    read: true,
    write: false,
  },
  status_on: {
    role: "state",
    name: "HomeMode status",
    type: "boolean",
    read: true,
    write: true,
  },
  stop: {
    role: "button.stop",
    name: "Controlling playback stop",
    type: "boolean",
    read: false,
    write: true,
  },
  subplayer_volume: {
    role: "level.volume",
    name: "Subplayer volume if supported",
    type: "number",
    min: 0,
    max: 100,
    read: true,
    write: true,
  },
  support_bluetooth: {
    role: "state",
    name: "Support bluetooth",
    type: "boolean",
    read: true,
    write: false,
  },
  support_file_request: {
    role: "state",
    name: "Support file request",
    type: "boolean",
    read: true,
    write: false,
  },
  support_sharing: {
    role: "state",
    name: "Support sharing",
    type: "boolean",
    read: true,
    write: false,
  },
  support_usb: {
    role: "state",
    name: "Support USB",
    type: "boolean",
    read: true,
    write: false,
  },
  support_vfs: {
    role: "state",
    name: "Support VFS",
    type: "boolean",
    read: true,
    write: false,
  },
  support_virtual_library: {
    role: "state",
    name: "Support virtual library",
    type: "boolean",
    read: true,
    write: false,
  },
  tag_edit: {
    role: "state",
    name: "Tag edit",
    type: "boolean",
    read: true,
    write: false,
  },
  temperature: {
    role: "value.temperature",
    name: "Temperature",
    type: "number",
    unit: "°C",
    read: true,
    write: false,
  },
  temperature_warn: {
    role: "indicator.maintenance",
    name: "Temperature warn",
    type: "boolean",
    read: true,
    write: false,
  },
  timezone_offset: {
    role: "state",
    name: "Timezone offset",
    type: "number",
    read: true,
    write: false,
  },
  title: {
    role: "media.title",
    name: "Title",
    type: "string",
    read: true,
    write: false,
  },
  total_size: {
    role: "value",
    name: "Total size",
    type: "number",
    unit: "GB",
    read: true,
    write: false,
  },
  transcode: {
    role: "state",
    name: "Transcode",
    type: "boolean",
    read: true,
    write: false,
  },
  transcode_to_mp3: {
    role: "state",
    name: "Transcode to mp3",
    type: "boolean",
    read: true,
    write: false,
  },
  uid: { role: "state", name: "UID", type: "number", read: true, write: false },
  upgrade_ready: {
    role: "state",
    name: "Upgrade ready",
    type: "boolean",
    read: true,
    write: false,
  },
  upnp_browse: {
    role: "state",
    name: "UPnP browse",
    type: "boolean",
    read: true,
    write: false,
  },
  uptime: {
    role: "value.interval",
    name: "Uptime",
    type: "number",
    unit: "s",
    read: true,
    write: false,
  },
  used: {
    role: "value",
    name: "Used",
    type: "number",
    unit: "%",
    read: true,
    write: false,
  },
  used_size: {
    role: "value",
    name: "Used size",
    type: "number",
    unit: "GB",
    read: true,
    write: false,
  },
  version: {
    role: "value",
    name: "Version",
    type: "number",
    read: true,
    write: false,
  },
  version_string: {
    role: "info.firmware",
    name: "Firmware version",
    type: "string",
    read: true,
    write: false,
  },
  volume: {
    role: "level.volume",
    name: "Volume",
    type: "number",
    min: 0,
    max: 100,
    read: true,
    write: true,
  },
  year: {
    role: "media.date",
    name: "Year",
    type: "number",
    read: true,
    write: false,
  },
};

type PollApi = "dsm" | "fs" | "dl" | "as" | "vs" | "dtv" | "ss";
type PollName = "firstPoll" | "fastPoll" | "slowPoll";
interface PollRequest {
  api: PollApi;
  method: string;
  params: Record<string, unknown>;
  ParseFunction: (...args: never[]) => void;
}
type PollFunction = (...args: never[]) => unknown;
type PollTask = PollRequest | PollFunction;

const PollCmd: Record<PollName, PollTask[]> = {
  firstPoll: [
    {
      api: "dsm",
      method: "getPollingData",
      params: {},
      ParseFunction: parseInstallingPackets,
    }, // OR listPackages if < 6 || 7 See in main function
    //{api: 'dsm', method: 'listPackages', params: {}, ParseFunction: parseInstallingPackets}, // OR listPackages if < 6 || 7 See in main function
    { api: "dsm", method: "getInfo", params: {}, ParseFunction: parseInfo },
    { api: "fs", method: "getInfo", params: {}, ParseFunction: parseInfo },
    { api: "dl", method: "getInfo", params: {}, ParseFunction: parseInfo },
    { api: "as", method: "getInfo", params: {}, ParseFunction: parseInfo },
    { api: "vs", method: "getInfo", params: {}, ParseFunction: parseInfo },
    {
      api: "dtv",
      method: "GetInfoTuner",
      params: {},
      ParseFunction: parseInfo,
    },
    { api: "ss", method: "getInfo", params: {}, ParseFunction: parseInfo },
    {
      api: "ss",
      method: "getInfoHomeMode",
      params: { need_mobiles: true },
      ParseFunction: parseInfoHomeMode,
    },
    {
      api: "ss",
      method: "listCameras",
      params: { basic: true, version: 7 },
      ParseFunction: parselistCameras,
    },
    {
      api: "as",
      method: "listRemotePlayers",
      params: { type: "all", additional: "subplayer_list" },
      ParseFunction: parseListRemotePlayers,
    },
  ],
  fastPoll: [
    {
      api: "dsm",
      method: "getSystemUtilization",
      params: {},
      ParseFunction: parseSystemUtilization,
    },
    {
      api: "dsm",
      method: "getSystemStatus",
      params: {},
      ParseFunction: parseSystemStatus,
    },
    { api: "dsm", method: "getInfo", params: {}, ParseFunction: parseTempInfo },
    {
      api: "dsm",
      method: "infoSystem",
      params: { type: "storage", version: 1 },
      ParseFunction: parseInfoSystem,
    },
    getStatusPlayer,
    {
      api: "ss",
      method: "getInfoHomeMode",
      params: { need_mobiles: true },
      ParseFunction: parseInfoHomeMode,
    },
    {
      api: "ss",
      method: "listCameras",
      params: { basic: true, version: 7 },
      ParseFunction: parselistCameras,
    },
    {
      api: "dl",
      method: "getConfigSchedule",
      params: {},
      ParseFunction: parsegetConfigSchedule,
    },
    {
      api: "fs",
      method: "listSharings",
      params: {},
      ParseFunction: parseListSharings,
    },
  ],
  slowPoll: [
    {
      api: "as",
      method: "listRemotePlayers",
      params: { type: "all", additional: "subplayer_list" },
      ParseFunction: parseListRemotePlayers,
    },
    {
      api: "dl",
      method: "listTasks",
      params: {},
      ParseFunction: parselistTasks,
    },
    {
      api: "as",
      method: "listRadios",
      params: {
        container: "Favorite",
        limit: 1000,
        library: "shared",
        sort_direction: "ASC",
      },
      ParseFunction: parselistRadios,
    },
    pollSmartAttributes,
    addLinkSnapShot,
    getLiveViewPathCamera,
  ],
};

/************************ SurveillanceStation ***********************/

const getIdsCams = (): string => {
  const ids: Array<string | number> = [];
  Object.keys(states.SurveillanceStation.cameras).forEach((nameCam) => {
    const id = states.SurveillanceStation.cameras[nameCam].id;
    if (id !== undefined) {
      ids.push(id);
    }
  });
  return ids.join(",");
};

const getNameCams = (id: string | number): string | undefined => {
  for (const nameCam in states.SurveillanceStation.cameras) {
    if (
      !Object.prototype.hasOwnProperty.call(
        states.SurveillanceStation.cameras,
        nameCam,
      )
    ) {
      continue;
    }
    if (states.SurveillanceStation.cameras[nameCam].id === id) {
      return nameCam;
    }
  }
};

function switchCam(name: string, command: string, val: unknown): void {
  const method = val ? "enableCamera" : "disableCamera";
  if (name !== "undefined" && states.SurveillanceStation.cameras[name]) {
    const cameraId = states.SurveillanceStation.cameras[name].id;
    if (cameraId === undefined) {
      return;
    }
    const camId = cameraId.toString();
    send("ss", method, {
      cameraIds: camId,
      blIncludeDeletedCam: false,
      version: 7,
    });
  }
}

function addLinkSnapShot(): void {
  debug("addLinkSnapShot");
  if (!syno) {
    return;
  }
  const synologyClient = syno;
  Object.keys(states.SurveillanceStation.cameras).forEach((nameCam) => {
    if (nameCam !== undefined) {
      const camId = states.SurveillanceStation.cameras[nameCam].id;
      if (camId !== undefined) {
        states.SurveillanceStation.cameras[nameCam].linkSnapshot =
          createSnapshotLink(synologyClient, camId);
      }
    }
  });
}

function getLiveViewPathCamera(): void {
  debug("getLiveViewPathCamera");
  const ids = getIdsCams();
  if (ids) {
    send("ss", "getLiveViewPathCamera", { idList: ids }, (res) => {
      if (Array.isArray(res)) {
        res.forEach((item: Record<string, unknown>) => {
          if (item.id === undefined || item.id === null) {
            return;
          }
          const nameCam = getNameCams(item.id as string | number);
          const camera = nameCam && states.SurveillanceStation.cameras[nameCam];
          if (camera) {
            if (typeof item.mjpegHttpPath === "string") {
              camera.linkMjpegHttpPath = item.mjpegHttpPath;
            }
            if (typeof item.multicstPath === "string") {
              camera.linkMulticstPath = item.multicstPath;
            }
            if (typeof item.mxpegHttpPath === "string") {
              camera.linkMxpegHttpPath = item.mxpegHttpPath;
            }
            if (typeof item.rtspOverHttpPath === "string") {
              camera.linkRtspOverHttpPath = item.rtspOverHttpPath;
            }
            if (typeof item.rtspPath === "string") {
              camera.linkRtspPath = item.rtspPath;
            }
          }
        });
      }
    });
  }
}

function getSnapshotCamera(camid: unknown, cb?: SnapshotCallback): void {
  debug("getSnapshotCamera");
  const cameraId = Number(camid);
  const cameraName = getNameCams(cameraId);
  const camera = cameraName && states.SurveillanceStation.cameras[cameraName];
  const param = { cameraId, preview: true, version: 7 };
  send("ss", "getSnapshotCamera", param, async (res) => {
    if (adapterUnloading) {
      return;
    }
    const responseError =
      typeof res === "object" && res !== null
        ? (res as { code?: number; message?: unknown })
        : undefined;
    if (responseError?.code === 400 && camera && isH265(camera.codec)) {
      adapter.log.debug(
        `Surveillance Station could not create a snapshot for H.265 camera ${cameraName}; trying FFmpeg`,
      );
      return ensureH265StreamPath(camera, cameraId, (hasPath: boolean) => {
        if (!hasPath) {
          adapter.log.error(
            `Cannot get RTSP stream path for H.265 camera ${cameraName}`,
          );
          return cb && cb(false);
        }
        captureH265Snapshot(camera, cameraId, (result) => cb?.(result));
      });
    }
    const buf = toBuffer(res);
    if (
      !buf ||
      (responseError && (responseError.code || responseError.message))
    ) {
      adapter.log.warn(
        `Surveillance Station returned no snapshot for camera ${cameraName || cameraId}: ${responseError?.message ? formatUnknown(responseError.message) : JSON.stringify(res)}`,
      );
      return cb?.(false);
    }

    try {
      const filename = `snapshotCam_${cameraId}.jpg`;
      const localPath = path.join(dir, filename);
      await adapter.writeFileAsync(adapter.namespace, filename, buf);
      const fileExistsInDb = await adapter.fileExistsAsync(
        adapter.namespace,
        filename,
      );
      let directoryContents;
      try {
        directoryContents = await adapter.readDirAsync(adapter.namespace, "/");
      } catch (err) {
        adapter.log.warn(
          `Cannot read ioBroker file directory ${adapter.namespace}/: ${String(err)}`,
        );
      }
      fs.writeFileSync(localPath, buf);
      const localFileSize = fs.statSync(localPath).size;
      debug(
        `Snapshot created for camera ${formatUnknown(camid)}: ioBroker file ${adapter.namespace}/${filename} ${fileExistsInDb ? "verified" : "missing"}, directory listing ${directoryContents ? JSON.stringify(directoryContents.map((entry) => entry.file)) : "unavailable"}, local file ${localPath} (${localFileSize} bytes)`,
      );
      cb?.(localPath);
    } catch (err) {
      adapter.log.warn(
        `Cannot create snapshot for camera ${cameraId}: ${String(err)}`,
      );
      cb?.(false);
    }
  });
}

function captureH265Snapshot(
  camera: CameraState,
  cameraId: number,
  cb?: SnapshotCallback,
): void {
  enqueueH265Snapshot(cameraId, () => {
    if (adapterUnloading) {
      return false;
    }
    return runH265Snapshot(camera, cameraId);
  })
    .then((result: SnapshotResult) => {
      if (!adapterUnloading) {
        cb?.(result);
      }
    })
    .catch((err: unknown) => {
      adapter.log.error(
        `Cannot create H.265 snapshot for camera ${getNameCams(cameraId) || cameraId}: ${String(err)}`,
      );
      if (!adapterUnloading) {
        cb?.(false);
      }
    });
}

function ensureH265StreamPath(
  camera: CameraState,
  cameraId: number,
  cb: (hasPath: boolean) => void,
): void {
  if (adapterUnloading) {
    return;
  }
  if (camera.linkRtspOverHttpPath) {
    return cb(true);
  }
  send("ss", "getLiveViewPathCamera", { idList: String(cameraId) }, (res) => {
    if (adapterUnloading) {
      return;
    }
    if (Array.isArray(res)) {
      res.forEach((item) => {
        const name = getNameCams(item.id);
        if (name && states.SurveillanceStation.cameras[name]) {
          const target = states.SurveillanceStation.cameras[name];
          if (typeof item.mjpegHttpPath === "string") {
            target.linkMjpegHttpPath = item.mjpegHttpPath;
          }
          if (typeof item.multicstPath === "string") {
            target.linkMulticstPath = item.multicstPath;
          }
          if (typeof item.mxpegHttpPath === "string") {
            target.linkMxpegHttpPath = item.mxpegHttpPath;
          }
          if (typeof item.rtspOverHttpPath === "string") {
            target.linkRtspOverHttpPath = item.rtspOverHttpPath;
          }
          if (typeof item.rtspPath === "string") {
            target.linkRtspPath = item.rtspPath;
          }
        }
      });
    }
    cb(!!camera.linkRtspOverHttpPath);
  });
}

async function runH265Snapshot(
  camera: CameraState,
  cameraId: number,
): Promise<SnapshotResult> {
  if (adapterUnloading) {
    return false;
  }
  if (!syno) {
    return false;
  }
  const cameraName = getNameCams(cameraId) || cameraId;
  let rtspUrl;
  try {
    rtspUrl = createRtspUrl({ ...camera, id: cameraId }, syno.host);
    fs.rmSync(path.join(dir, `snapshotCam_${cameraId}.jpg`), { force: true });
  } catch (err) {
    adapter.log.error(
      `Cannot prepare H.265 snapshot for ${cameraName}: ${String(err)}`,
    );
    return false;
  }

  const snapshotPath = path.join(dir, `snapshotCam_${cameraId}.jpg`);
  if (adapterUnloading) {
    return false;
  }
  return new Promise<SnapshotResult>((resolve) => {
    let timedOut = false;
    let finished = false;
    let ffmpeg: ReturnType<typeof spawn> | undefined;
    const timeoutRef: { current?: ioBroker.Timeout } = {};
    const capture = {
      done: Promise.resolve(),
      resolveDone: () => {},
      cancel: () => {
        adapter.clearTimeout(timeoutRef.current);
        ffmpeg?.kill("SIGKILL");
      },
    };
    const finish = (result: SnapshotResult): void => {
      if (finished) {
        return;
      }
      finished = true;
      adapter.clearTimeout(timeoutRef.current);
      activeH265Captures.delete(capture);
      resolve(result);
      capture.resolveDone();
    };
    capture.done = new Promise((done) => {
      capture.resolveDone = done;
    });
    activeH265Captures.add(capture);
    try {
      ffmpeg = spawn(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-rtsp_transport",
          "tcp",
          "-i",
          rtspUrl,
          "-frames:v",
          "1",
          "-q:v",
          "2",
          "-y",
          snapshotPath,
        ],
        { stdio: "ignore" },
      );
    } catch (err) {
      if (err instanceof Error && "code" in err && err.code === "ENOENT") {
        adapter.log.error(
          "FFmpeg is not installed or not available in PATH; it is required for H.265 snapshots. Install via SSH on the ioBroker host: sudo apt update && sudo apt install ffmpeg",
        );
      } else {
        adapter.log.error(
          `Could not start FFmpeg for H.265 camera ${cameraName}: ${String(err)}`,
        );
      }
      return finish(false);
    }

    timeoutRef.current = adapter.setTimeout(() => {
      timedOut = true;
      ffmpeg.kill("SIGKILL");
    }, 20000);
    ffmpeg.once("error", (err) => {
      if (err instanceof Error && "code" in err && err.code === "ENOENT") {
        adapter.log.error(
          "FFmpeg is not installed or not available in PATH; it is required for H.265 snapshots. Install via SSH on the ioBroker host: sudo apt update && sudo apt install ffmpeg",
        );
      } else {
        adapter.log.error(
          `Could not start FFmpeg for H.265 camera ${cameraName}: ${String(err)}`,
        );
      }
      finish(false);
    });
    ffmpeg.once("close", async (code) => {
      if (finished) {
        return;
      }
      if (adapterUnloading) {
        finish(false);
        return;
      }
      if (timedOut) {
        adapter.log.error(
          `FFmpeg timed out while creating a snapshot for H.265 camera ${cameraName}`,
        );
        finish(false);
        return;
      }
      if (code !== 0) {
        adapter.log.error(
          `FFmpeg failed to create a snapshot for H.265 camera ${cameraName} (exit code ${code})`,
        );
        finish(false);
        return;
      }

      try {
        const image = fs.readFileSync(snapshotPath);
        if (
          image.length < 4 ||
          image[0] !== 0xff ||
          image[1] !== 0xd8 ||
          image[2] !== 0xff
        ) {
          throw new Error("FFmpeg did not produce a valid JPEG image");
        }
        if (adapterUnloading) {
          return finish(false);
        }
        await adapter.writeFileAsync(
          adapter.namespace,
          `snapshotCam_${cameraId}.jpg`,
          image,
        );
        finish(adapterUnloading ? false : snapshotPath);
      } catch (err) {
        adapter.log.error(
          `No snapshot image was produced for H.265 camera ${cameraName}: ${String(err)}`,
        );
        finish(false);
      }
    });
  });
}
/*
function parselistEvents(res) {
    debug(`test - Response: ${JSON.stringify(res)}`);
    if (res.events.length > 0) {
        res.events.forEach((event) => {
            states.SurveillanceStation.cameras[event.camera_name].motionDetected = true;
        });
    }
}
*/
interface SynologyCamera {
  id: number;
  name?: string;
  newName?: string;
  host?: string;
  ip?: string;
  port?: number;
  model?: string;
  vendor?: string;
  videoType?: string;
  detailInfo?: { camVideoType?: string };
  videoCodec?: string | number;
  status: string | number;
  recStatus: string | number;
  enabled?: boolean;
}

function parselistCameras(res: { cameras: SynologyCamera[] }): void {
  debug(`listCameras - Response: ${JSON.stringify(res)}`);
  const arr = res.cameras;
  arr.forEach((cameraData) => {
    if (cameraData.newName) {
      cameraData.name = cameraData.newName; // DSM 7
    }

    if (cameraData.name) {
      if (states.SurveillanceStation.cameras[cameraData.name] === undefined) {
        states.SurveillanceStation.cameras[cameraData.name] = {};
      }
      states.SurveillanceStation.cameras[cameraData.name].host =
        cameraData.host || cameraData.ip;
      states.SurveillanceStation.cameras[cameraData.name].id = cameraData.id;
      states.SurveillanceStation.cameras[cameraData.name].codec =
        getCameraCodec(cameraData, stateSS.videoCodec);
      // Rebuild immediately, including when a camera was recreated with the same name.
      if (syno) {
        states.SurveillanceStation.cameras[cameraData.name].linkSnapshot =
          createSnapshotLink(syno, cameraData.id);
      }
      states.SurveillanceStation.cameras[cameraData.name].port =
        cameraData.port;
      states.SurveillanceStation.cameras[cameraData.name].model =
        cameraData.model;
      states.SurveillanceStation.cameras[cameraData.name].vendor =
        cameraData.vendor;
      states.SurveillanceStation.cameras[cameraData.name].videoCodec =
        cameraData.videoCodec === undefined
          ? undefined
          : stateSS.videoCodec[String(cameraData.videoCodec)];
      states.SurveillanceStation.cameras[cameraData.name].status =
        stateSS.camStatus[String(cameraData.status)];
      states.SurveillanceStation.cameras[cameraData.name].recStatus =
        stateSS.recStatus[String(cameraData.recStatus)];
      states.SurveillanceStation.cameras[cameraData.name].enabled =
        cameraData.enabled;
      states.SurveillanceStation.cameras[cameraData.name].motionDetected =
        false;
      states.SurveillanceStation.cameras[cameraData.name].motionDetected =
        cameraData.recStatus === 2;
    }
  });
}

function parseInfoHomeMode(res: Record<string, unknown>): void {
  debug(`InfoHomeMode - Response: ${JSON.stringify(res)}`);
  states.SurveillanceStation.HomeMode.status_on = res.on;
  states.SurveillanceStation.HomeMode.notify_on = res.notify_on;
  states.SurveillanceStation.HomeMode.onetime_disable_on =
    res.onetime_disable_on;
  states.SurveillanceStation.HomeMode.onetime_disable_time = unixToDate(
    res.onetime_disable_time as number,
  );
  states.SurveillanceStation.HomeMode.onetime_enable_on = res.onetime_enable_on;
  states.SurveillanceStation.HomeMode.onetime_enable_time = unixToDate(
    res.onetime_enable_time as number,
  );
  states.SurveillanceStation.HomeMode.geo_lat = res.geo_lat;
  states.SurveillanceStation.HomeMode.geo_lng = res.geo_lng;
  states.SurveillanceStation.HomeMode.geo_radius = res.geo_radius;
  states.SurveillanceStation.HomeMode.wifi_ssid = res.wifi_ssid;
}

function parseSSInfo(res: Record<string, unknown>): void {
  states.SurveillanceStation.info.CMSMinVersion = res.CMSMinVersion;
  states.SurveillanceStation.info.cameraNumber = res.cameraNumber;
  states.SurveillanceStation.info.isLicenseEnough = res.isLicenseEnough;
  states.SurveillanceStation.info.liscenseNumber = res.liscenseNumber;
  states.SurveillanceStation.info.maxCameraSupport = res.maxCameraSupport;
  states.SurveillanceStation.info.enableVideoRelay = res.enableVideoRelay;
  states.SurveillanceStation.info.remindQuickconnectTunnel =
    res.remindQuickconnectTunnel;
  states.DiskStationManager.info.hostname = res.hostname;
  states.DiskStationManager.info.timezone = res.timezone;
  states.DiskStationManager.info.unique = res.unique;
  states.DiskStationManager.info.serviceVolSize = res.serviceVolSize;
  states.DiskStationManager.info.productName = res.productName;
}

/*********************** DownloadStation ************************/

function addDownload(command: string, url: unknown, cb?: () => void): void {
  if (url) {
    debug("addDownload");
    let uri = formatUnknown(url);
    if (command === "add_hash_download") {
      uri = `magnet:?xt=urn:btih:${uri}`;
    }
    const param: Record<string, unknown> = {
      type: "url",
      create_list: true,
      uri: [uri],
      version: 2,
    };
    adapter.getState("DownloadStation.folder", (err, state) => {
      if (!err && state) {
        param.destination = state.val;
      }
      send("dl", "createTask", param, (res: unknown) => {
        if (isRecord(res) && res.message) {
          error("addDownload Error: ", formatUnknown(res.message));
        }
        cb && cb();
      });
    });
  } else {
    error("addDownload", "Link not set");
  }
}

function setConfigSchedule(command: string, val: unknown): void {
  debug("setConfigSchedule");
  let param;
  if (command === "shedule_enabled") {
    param = { enabled: val };
  }
  if (command === "shedule_emule_enabled") {
    param = { emule_enabled: val };
  }
  send("dl", "setConfigSchedule", param, (res: unknown) => {
    if (isRecord(res) && res.message) {
      error("setConfigSchedule Error: ", formatUnknown(res.message));
    }
  });
}

function pauseTask(command: string, val: unknown): void {
  debug("pauseTask");
  let param;
  let method;
  const taskIds: string[] = [];
  const taskValue = String(val);
  if (!~taskValue.indexOf("dbid_") && val !== "all") {
    param = { id: `dbid_${taskValue}` };
  } else if (val === "all") {
    try {
      const arr: unknown = JSON.parse(
        formatUnknown(states.DownloadStation.listTasks ?? "[]"),
      );
      if (Array.isArray(arr) && arr.length > 0) {
        arr.forEach((task: unknown) => {
          if (isRecord(task) && task.id !== undefined) {
            taskIds.push(formatUnknown(task.id));
          }
        });
        param = { id: taskIds.join(",") };
      }
    } catch {
      // ignore
    }
  } else {
    param = { id: taskValue };
  }
  if (command === "pause_task") {
    method = "pauseTask";
  }
  if (command === "resume_task") {
    method = "resumeTask";
  }
  if (!method) {
    return;
  }
  send("dl", method, param, (res: unknown) => {
    if (isRecord(res) && res.message) {
      adapter.log.error(`pauseTask Error: ${formatUnknown(res.message)}`);
    }
  });
}

function parsegetConfigSchedule(res: Record<string, unknown>): void {
  debug(`getConfigSchedule - Response: ${JSON.stringify(res)}`);
  if (res && !res.message) {
    states.DownloadStation.shedule_emule_enabled = res.emule_enabled;
    states.DownloadStation.shedule_enabled = res.enabled;
  }
}

function parselistTasks(res: {
  message?: unknown;
  tasks?: Array<Record<string, unknown>>;
}): void {
  debug(`listTasks - Response: ${JSON.stringify(res)}`);
  if (res && !res.message) {
    const task: Array<Record<string, unknown>> = [];
    (res.tasks ?? []).forEach((obj) => {
      if (obj.status !== "finished") {
        task.push(obj);
      }
    });
    states.DownloadStation.listTasks = JSON.stringify(task);
    states.DownloadStation.activeTask = task.length;
  }
}

/************************* AudioStation *************************/

function clearPlaylist(playerid: string, cb?: () => void): void {
  const param = {
    id: playerid,
    offset: 0,
    songs: "",
    limit: states.AudioStation.players[playerid].playlist_total || 10000,
    updated_index: -1,
  };
  send("as", "updatePlayListRemotePlayer", param, () => {
    cb && cb();
  });
}

function clearPlayerStates(playerid: string, cb?: () => void): void {
  debug(`Clearing the player status ${playerid}`);
  states.AudioStation.players[playerid].playlist_total = 0;
  states.AudioStation.players[playerid].volume = 0;
  states.AudioStation.players[playerid].album = "";
  states.AudioStation.players[playerid].artist = "";
  states.AudioStation.players[playerid].genre = "";
  states.AudioStation.players[playerid].year = 0;
  states.AudioStation.players[playerid].song_id = 0;
  states.AudioStation.players[playerid].title = "";
  states.AudioStation.players[playerid].path = "";
  states.AudioStation.players[playerid].repeat = "";
  states.AudioStation.players[playerid].shuffle = false;
  states.AudioStation.players[playerid].bitrate = "0";
  states.AudioStation.players[playerid].duration = "0";
  states.AudioStation.players[playerid].current_duration = "0";
  states.AudioStation.players[playerid].current_elapsed = "0";
  states.AudioStation.players[playerid].duration_sec = 0;
  states.AudioStation.players[playerid].seek = 0;
  states.AudioStation.players[playerid].playlist = "";
  states.AudioStation.players[playerid].current_play = 0;
  states.AudioStation.players[playerid].cover = "";
  cb && cb();
}

async function getStatusPlayer(cb?: () => void): Promise<void> {
  function getOneStatusPlayer(playerid: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      debug(`* getStatusPlayer ${playerid}`);
      const param = {
        id: playerid,
        additional: "song_tag, song_audio, subplayer_volume",
      };
      send("as", "getStatusRemotePlayerStatus", param, (response) => {
        const res = isRecord(response) ? response : undefined;
        if (res && typeof res.state === "string") {
          const status = res as unknown as RemotePlayerStatus;
          let state = status.state;
          if (state === "playing") {
            state = "play";
          } else if (
            state === "stopped" ||
            state === "none" ||
            state === "no-media" ||
            state === "transition"
          ) {
            state = "stop";
          }
          states.AudioStation.players[playerid].state_playing = state;
          states.AudioStation.players[playerid].online = true;
          if (
            (status.state === "playing" || status.state === "pause") &&
            status.song
          ) {
            parseRemotePlayerStatus(playerid, status);
            getPlaylist(playerid, () => {
              getSongCover(playerid);
            });
          } else {
            if (states.AudioStation.players[playerid].playlist_total !== 0) {
              clearPlayerStates(playerid);
            }
          }
        } else {
          states.AudioStation.players[playerid].online = false;
          states.AudioStation.players[playerid].state_playing = "stop";
          clearPlayerStates(playerid);
          if (response === false && timeOutReconnect) {
            reject(
              new Error("Remote player status unavailable during reconnect"),
            );
          }
        }
        resolve(true);
      });
    });
  }

  for (const playerid of Object.keys(states.AudioStation.players)) {
    if (playerid && states.AudioStation.players[playerid].online) {
      try {
        await getOneStatusPlayer(playerid);
      } catch {
        break;
      }
    }
  }
  cb && cb();
}

function getSongCover(playerid: string, cb?: () => void): void {
  debug("getSongCover");
  const track = states.AudioStation.players[playerid].song_id;
  if (track !== old_states.AudioStation.players[playerid].song_id) {
    old_states.AudioStation.players[playerid].song_id = track;
    send("as", "getSongCover", { id: track }, async (res) => {
      const buf = toBuffer(res);
      if (buf) {
        await adapter.writeFileAsync(adapter.namespace, "cover.jpg", buf);
        states.AudioStation.players[playerid].cover =
          `../${adapter.namespace}/cover.jpg`;
      } else {
        states.AudioStation.players[playerid].cover =
          `../${adapter.namespace}/cover.png`;
      }
      cb && cb();
    });
  }
}

function getPlaylist(playerid: string, cb?: () => void): void {
  debug("getPlaylist");
  send("as", "getPlayListRemotePlayer", { id: playerid }, (res) => {
    if (res) {
      parsePlayListRemotePlayer(playerid, res);
      cb && cb();
    }
  });
}

function Browser(playerid: string, val: unknown): void {
  debug("Browser");
  let param = {};
  if (val && val !== "/") {
    if (formatUnknown(val).includes("dir_")) {
      param = { id: val };
    } else {
      try {
        const obj: { files: Array<{ file: string; id: string | number }> } =
          JSON.parse(states.AudioStation.players[playerid].Browser ?? "{}");
        for (const dir_id in obj.files) {
          if (!Object.prototype.hasOwnProperty.call(obj.files, dir_id)) {
            continue;
          }
          if (obj.files[dir_id].file === val) {
            param = { id: obj.files[dir_id].id };
          }
        }
      } catch {
        param = {};
        states.AudioStation.players[playerid].Browser = "";
      }
    }
  }
  send("as", "listFolders", param, (response) => {
    const arr: { files: Array<Record<string, unknown>> } = { files: [] };
    if (isRecord(response) && Array.isArray(response.items)) {
      const items = response.items.filter(isRecord);
      items.forEach((item) => {
        let filetype = "file";
        if (item.type === "folder") {
          filetype = "directory";
        }
        arr.files.push({
          id: item.id,
          file: item.path,
          filetype: filetype,
          title: item.title,
        });
      });
      states.AudioStation.players[playerid].Browser = JSON.stringify(arr);
      old_states.AudioStation.players[playerid].Browser = "";
    }
  });
}

function PlayControl(playerid: string, cmd: string, val: unknown): void {
  debug("PlayControl");
  const param: Record<string, unknown> = {
    id: playerid,
    action: cmd,
    value: null,
  };
  if (playerid) {
    if (cmd === "volume") {
      param.action = "set_volume";
      param.value = val;
    }
    if (cmd === "seek") {
      param.value = parseFloat(
        (
          (Number(val) / 100) *
          Number(states.AudioStation.players[playerid].duration_sec)
        ).toFixed(4),
      );
    }
    if (cmd === "repeat") {
      param.action = "set_repeat";
      param.value = val;
    }
    if (cmd === "shuffle") {
      param.action = "set_shuffle";
      param.value = val;
    }
    send("as", "controlRemotePlayer", param);
  }
}

function PlayFolder(playerid: string, folder: unknown): void {
  debug("PlayFolder");
  let param = {};
  if (playerid) {
    send("as", "controlRemotePlayer", { id: playerid, action: "stop" }, () => {
      clearPlaylist(playerid, () => {
        param = {
          id: playerid,
          library: "shared",
          keep_shuffle_order: false,
          offset: 0,
          limit: 0,
          play: true,
          containers_json: JSON.stringify([
            {
              type: "folder",
              id: folder,
              recursive: true,
              sort_by: "title",
              sort_direction: "ASC",
            },
          ]),
        };
        send("as", "updatePlayListRemotePlayer", param, () => {
          //add folder to playlist
          send("as", "controlRemotePlayer", { id: playerid, action: "play" });
        });
      });
    });
  }
}

function PlayTrack(playerid: string, val: unknown): void {
  debug("PlayTrack");
  let param = {};
  if (playerid) {
    param = {
      id: playerid,
      library: "shared",
      offset: 0,
      limit: 0,
      play: true,
      songs: val,
      keep_shuffle_order: false,
      //containers_json: JSON.stringify([])
    };
    send("as", "updatePlayListRemotePlayer", param, () => {
      // updatesongsPlaylist
      send("as", "controlRemotePlayer", {
        id: playerid,
        action: "play",
        value: 0,
      });
    });
  }
}

function PlayTrackNum(playerid: string, val: unknown): void {
  debug("PlayTrackNum");
  if (playerid) {
    send("as", "controlRemotePlayer", {
      id: playerid,
      action: "play",
      value: val,
    });
  }
}

function PlayTrackId(playerid: string, val: unknown): void {
  debug("PlayTrack");
  try {
    const arr: Array<{ id: string | number }> = JSON.parse(
      states.AudioStation.players[playerid].playlist ?? "[]",
    );
    const track = arr.findIndex((item) => item.id === val);
    if (track) {
      send("as", "controlRemotePlayer", {
        id: playerid,
        action: "play",
        value: track,
      });
    } else {
      error("PlayTrackId:", "Error track not found");
    }
  } catch {
    error("PlayTrackId:", "Error parse playlist");
  }
}

function parseListRemotePlayers(res: {
  players: Array<{ id: string | number; name: string }>;
}): void {
  debug(`ListRemotePlayers - Response: ${JSON.stringify(res)}`);
  //states.AudioStation.info.RemotePlayers = JSON.stringify(res.players);
  res.players.forEach((player) => {
    const playerid = String(player.id);
    if (states.AudioStation.players[playerid] === undefined) {
      states.AudioStation.players[playerid] = {};
      states.AudioStation.players[playerid].online = true;
      states.AudioStation.players[playerid].player_name = player.name;
      states.AudioStation.players[playerid].stop = false;
      states.AudioStation.players[playerid].pause = false;
      states.AudioStation.players[playerid].play = false;
      states.AudioStation.players[playerid].prev = false;
      states.AudioStation.players[playerid].next = false;
      states.AudioStation.players[playerid].play_folder = "";
      states.AudioStation.players[playerid].play_track = "";
      states.AudioStation.players[playerid].Browser = "";
      states.AudioStation.players[playerid].clearPlaylist = false;
    }
  });
}

function parseRemotePlayerStatus(
  playerid: string,
  res: RemotePlayerStatus,
): void {
  debug(`RemotePlayerStatus - Response: ${JSON.stringify(res)}`);
  try {
    if (res.index !== undefined) {
      const seek = parseFloat(
        (
          (res.position / res.song.additional.song_audio.duration) *
          100
        ).toFixed(4),
      );
      states.AudioStation.players[playerid].current_play = parseInt(
        String(res.index),
        10,
      );
      states.AudioStation.players[playerid].playlist_total = res.playlist_total;
      states.AudioStation.players[playerid].volume = res.volume;
      states.AudioStation.players[playerid].subplayer_volume =
        res.subplayer_volume;
      states.AudioStation.players[playerid].album =
        res.song.additional.song_tag.album;
      states.AudioStation.players[playerid].artist =
        res.song.additional.song_tag.artist;
      states.AudioStation.players[playerid].genre =
        res.song.additional.song_tag.genre;
      states.AudioStation.players[playerid].year =
        res.song.additional.song_tag.year;
      states.AudioStation.players[playerid].song_id = res.song.id;
      states.AudioStation.players[playerid].title = res.song.title;
      states.AudioStation.players[playerid].path = res.song.path;
      states.AudioStation.players[playerid].repeat = res.play_mode.repeat;
      states.AudioStation.players[playerid].shuffle = res.play_mode.shuffle; // to bool
      states.AudioStation.players[playerid].bitrate = (
        res.song.additional.song_audio.bitrate / 1000
      ).toString();
      states.AudioStation.players[playerid].duration = secToText(
        res.song.additional.song_audio.duration,
      );
      states.AudioStation.players[playerid].duration_sec =
        res.song.additional.song_audio.duration;
      states.AudioStation.players[playerid].current_duration = secToText(
        res.position,
      );
      states.AudioStation.players[playerid].current_elapsed =
        res.song.additional.song_audio.duration > 0
          ? secToText(res.song.additional.song_audio.duration - res.position)
          : "0";
      states.AudioStation.players[playerid].seek = isFinite(seek) ? seek : 0;
    }
  } catch (e) {
    debug(`RemotePlayerStatus - Error: ${JSON.stringify(e)}`);
  }
}

function parsePlayListRemotePlayer(
  playerid: string,
  res: AudioPlaylistResponse,
): void {
  debug(`PlayListRemotePlayer - Response: ${JSON.stringify(res)}`);
  try {
    const playlist: Array<Record<string, unknown>> = [];
    if (res && res.songs) {
      const arr = res.songs;
      arr.forEach((song, i) => {
        playlist[i] = {
          id: song.id,
          artist: "",
          album: "",
          bitrate: 0,
          title: song.title,
          file: song.path,
          genre: "",
          year: 0,
          len: "00:00",
          rating: "",
          cover: "",
        };
      });
    }
    states.AudioStation.players[playerid].playlist = JSON.stringify(playlist);
  } catch {
    // ignore
  }
}

function parselistRadios(res: {
  message?: unknown;
  radios?: Array<{
    id: string | number;
    desc?: string;
    title: string;
    url: string;
  }>;
}): void {
  debug(`listRadios - Response: ${JSON.stringify(res)}`);
  if (res && !res.message) {
    try {
      const radio_playlist: Array<Record<string, unknown>> = [];
      if (res.radios) {
        res.radios.forEach((radio, i) => {
          radio_playlist[i] = {
            id: radio.id,
            artist: "",
            album: "",
            bitrate: radio.desc?.match(/\(.*?(\d+)/)?.[1] ?? "",
            title: radio.title,
            file: radio.url,
            genre: "",
            year: 0,
            len: "00:00",
            rating: "",
            cover: "",
          };
        });
        Object.keys(states.AudioStation.players).forEach((playerid) => {
          states.AudioStation.players[playerid].favoriteRadio =
            JSON.stringify(radio_playlist);
        });
      }
    } catch {
      debug(`listRadios - Error: ${JSON.stringify(res)}`);
    }
  }
}

/*********************** FileStation ************************/

function CreateSharing(command: string, link: unknown): void {
  debug("CreateSharings");
  let params_set: Record<string, unknown> = {};
  if (link) {
    try {
      const parsed: unknown = JSON.parse(formatUnknown(link));
      if (isRecord(parsed)) {
        params_set = parsed;
      }
    } catch {
      error(
        "CreateSharings",
        `Error JSON parse command ${formatUnknown(link)}`,
      );
    }
    if (!("path" in params_set)) {
      params_set.path = link;
    }
    if (!("password" in params_set)) {
      params_set.password = "";
    }
    send("fs", "createSharing", params_set, (res) => {
      if (isRecord(res) && Array.isArray(res.links)) {
        CreateSharings({ links: res.links.filter(isRecord) });
      }
    });
  } else {
    error("CreateSharings", "Link not set");
  }
}

function DeleteSharing(command: string, id: unknown): void {
  debug("DeleteSharings");
  if (id) {
    send("fs", "deleteSharing", { id: formatUnknown(id) });
  } else {
    error("DeleteSharings", "ID not set");
  }
}

function parseListSharings(res: {
  links: Array<Record<string, unknown>>;
}): void {
  debug(`parseListSharings - Response: ${JSON.stringify(res)}`);
  const arr = res.links;
  const temp_array: Array<Record<string, unknown>> = [];
  arr.forEach((sharing, i) => {
    if (sharing.id) {
      temp_array[i] = {
        name: sharing.name,
        date_available: sharing.date_available,
        date_expired: sharing.date_expired,
        expire_times: sharing.expire_times,
        enable_upload: sharing.enable_upload,
        has_password: sharing.has_password,
        id: sharing.id,
        isFolder: sharing.isFolder,
        link_owner: sharing.link_owner,
        limit_size: sharing.limit_size,
        path: sharing.path,
        qrcode: sharing.qrcode,
        status: sharing.status,
        url: sharing.url,
        request_info: sharing.request_info,
        request_name: sharing.request_name,
      };
    }
  });
  states.FileStation.sharing.list = JSON.stringify(temp_array);
}

function CreateSharings(res: {
  links: Array<{ url?: unknown; qrcode?: unknown }>;
}): void {
  debug(`parseCreateSharings - Response: ${JSON.stringify(res)}`);
  const arr = res.links;
  states.FileStation.sharing.last_url = JSON.stringify(arr[0].url);
  states.FileStation.sharing.last_qrcode = JSON.stringify(arr[0].qrcode);
}

/************************** DSM ****************************/

function parseInfoSystem(res: {
  hdd_info?: Array<{
    diskType: string;
    diskno: string;
    diskPath: string;
    model: string;
    status: string;
    ebox_order: string | number;
    temp: number;
    volume: string;
    capacity: number;
  }>;
  vol_info?: Array<{
    name: string;
    status: string;
    total_size: number;
    used_size: number;
    desc?: string;
    vol_desc?: string;
  }>;
}): void {
  debug(`InfoSystem - Response: ${JSON.stringify(res)}`);
  if (res && res.hdd_info) {
    res.hdd_info.forEach((key) => {
      const diskname = `${key.diskType.toLowerCase().replace(" ", "_")}_${key.diskno.toLowerCase().replace(" ", "_")}`;
      const diskInfo: DiskState = {
        diskno: key.diskno,
        diskPath: key.diskPath,
        model: key.model.replace(/\s{2,}/g, ""),
        overview_status: key.status,
        ebox_order: parseInt(String(key.ebox_order), 10),
        temperature: key.temp,
        storage_pool: key.volume,
        capacity: parseFloat((key.capacity / 1073741824).toFixed(2)),
        smart: {},
      };
      const previousDisk = states.DiskStationManager.hdd_info[diskname];
      diskInfo.smart =
        previousDisk && previousDisk.smart ? previousDisk.smart : {};
      states.DiskStationManager.hdd_info[diskname] = diskInfo;
    });
    if (res.vol_info) {
      res.vol_info.forEach((key) => {
        const volname = key.name.toLowerCase();
        states.DiskStationManager.vol_info[volname] = {
          name: key.name,
          status: key.status,
          total_size: parseFloat((key.total_size / 1073741824).toFixed(2)),
          used_size: parseFloat((key.used_size / 1073741824).toFixed(2)),
          used: parseFloat(((key.used_size / key.total_size) * 100).toFixed(2)),
          desc: key.desc || key.vol_desc,
        };
      });
    }
  }
}

function pollSmartAttributes(): void {
  if (
    !adapter.config.smart_over_ssh ||
    smartPollInProgress ||
    adapterUnloading
  ) {
    return;
  }
  const disks = Object.keys(states.DiskStationManager.hdd_info).filter(
    (diskName) => {
      const disk = states.DiskStationManager.hdd_info[diskName];
      return (
        typeof disk.diskPath === "string" &&
        /^\/dev\/[A-Za-z0-9_-]+$/.test(disk.diskPath)
      );
    },
  );
  if (!disks.length) {
    return;
  }

  smartPollInProgress = true;
  let index = 0;
  const pollNextDisk = (): void => {
    if (adapterUnloading || index >= disks.length) {
      smartPollInProgress = false;
      return;
    }

    const diskName = disks[index++];
    const disk = states.DiskStationManager.hdd_info[diskName];
    sendSSH(
      `smartctl -A -d sat ${disk.diskPath}`,
      (stdout, exitCode, stderr) => {
        if (adapterUnloading) {
          smartPollInProgress = false;
          return;
        }
        const attributes = parseSmartAttributes(stdout);
        if (Object.keys(attributes).length) {
          const currentDisk = states.DiskStationManager.hdd_info[diskName];
          if (currentDisk) {
            for (const name of Object.keys(attributes)) {
              currentDisk.smart[name] = attributes[name];
            }
          }
        } else {
          const details = formatUnknown(stderr || "")
            .trim()
            .replace(/\s+/g, " ")
            .slice(0, 300);
          adapter.log.warn(
            `Could not read SMART attributes for ${disk.diskno} (${disk.diskPath}); smartctl exited with code ${exitCode}${details ? `: ${details}` : ""}`,
          );
        }
        pollNextDisk();
      },
      true,
    );
  };
  pollNextDisk();
}

function parseInstallingPackets(res: {
  packages?: Record<string, boolean> | Array<{ id: string }>;
}): void {
  debug(`InstallingPackets - Response: ${JSON.stringify(res)}`);
  if (res && res.packages) {
    if (!Array.isArray(res.packages)) {
      for (const fullname in res.packages) {
        // for getPollingData
        if (!Object.prototype.hasOwnProperty.call(res.packages, fullname)) {
          continue;
        }
        for (const name in states.api) {
          if (!Object.prototype.hasOwnProperty.call(states.api, name)) {
            continue;
          }
          if (states.api[name].name === fullname) {
            states.api[name].installed = res.packages[fullname];
          }
        }
      }
    } else {
      const arr = res.packages; // for listPackages
      arr.forEach((obj) => {
        for (const name in states.api) {
          if (!Object.prototype.hasOwnProperty.call(states.api, name)) {
            continue;
          }
          if (states.api[name].name === obj.id) {
            states.api[name].installed = true;
          }
        }
      });
    }
  }
}

function parseInfo(res: Record<string, unknown>, api: PollApi): void {
  debug(`Info - Response: ${JSON.stringify(res)}`);
  if (states.api[api].installed) {
    const apiName = states.api[api].name;
    if (apiName !== "SurveillanceStation") {
      const stateGroup = (
        states as unknown as Record<string, { info: Record<string, unknown> }>
      )[apiName];
      Object.keys(res).forEach((key) => {
        if (key === "version") {
          stateGroup.info[key] = parseInt(String(res[key]), 10);
        } else {
          stateGroup.info[key] = res[key];
          if (
            apiName === "DiskStationManager" &&
            firstStart &&
            key === "version_string"
          ) {
            setAllInstalledForDsm7(res[key]);
          }
        }
      });
    } else {
      parseSSInfo(res);
    }
  }
}

function setAllInstalledForDsm7(VersionString: unknown): void {
  if (typeof VersionString !== "string") {
    return;
  }
  const VersionMatch = VersionString.match(/^DSM ([0-9]+)\./);
  if (!VersionMatch || !VersionMatch[1]) {
    return;
  }
  const VersionNumString = VersionMatch[1];
  info(`DSM ${VersionNumString}`);

  if (VersionNumString === "7") {
    info("DSM 7 detected, set all to true");
    states.api.dl.installed = true;
    states.api.as.installed = true;
    states.api.vs.installed = true;
    states.api.ss.installed = true;
  }
}

function parseTempInfo(res: Record<string, unknown>): void {
  debug(`TempInfo - Response: ${JSON.stringify(res)}`);
  states.DiskStationManager.info.temperature = res.temperature;
  states.DiskStationManager.info.temperature_warn = res.temperature_warn;
  states.DiskStationManager.info.time = res.time;
  states.DiskStationManager.info.uptime = parseInt(String(res.uptime), 10);
}

function parseSystemUtilization(res: Record<string, unknown>): void {
  debug(`SystemUtilization - Response: ${JSON.stringify(res)}`);
  if (isRecord(res.cpu) && isRecord(res.memory)) {
    states.DiskStationManager.info.cpu_load = parseInt(
      String(res.cpu.user_load),
      10,
    );
    states.DiskStationManager.info.memory_usage = parseInt(
      String(res.memory.real_usage),
      10,
    );
    states.DiskStationManager.info.memory_size = parseInt(
      String(res.memory.memory_size),
      10,
    );
  }
}

function parseSystemStatus(res: Record<string, unknown>): void {
  debug(`SystemStatus - Response: ${JSON.stringify(res)}`);
  states.DiskStationManager.info.is_disk_wcache_crashed =
    res.is_disk_wcache_crashed;
  states.DiskStationManager.info.is_system_crashed = res.is_system_crashed;
  states.DiskStationManager.info.upgrade_ready = res.upgrade_ready;
}

function sendMethod(name: string, val: unknown): void {
  debug(`sendMethod to ${name} cmd:${formatUnknown(val)}`);
  const api = isInstalled(name);
  if (api) {
    let param;
    try {
      const parsed: unknown = JSON.parse(String(val));
      if (!isRecord(parsed) || typeof parsed.method !== "string") {
        error(
          "sendMethod",
          `Error command - ${formatUnknown(val)} Method not specified`,
        );
      } else {
        const method = parsed.method;
        if (isRecord(parsed.params)) {
          param = parsed.params;
        } else {
          param = {};
        }
        send(api, method, param, (res) => {
          if (res) {
            const id = `${name}.sendMethod`;
            adapter.setState(id, { val: JSON.stringify(res), ack: true });
          }
        });
      }
    } catch (err) {
      error("sendMethod", `Error JSON parse command ${JSON.stringify(err)}`);
    }
  } else {
    error("sendMethod", `${name} Not installed!`);
  }
}

function queuePolling(): void {
  iteration = 0;
  let namePolling: PollName;
  if (endTime - startTime > slowPollingTime) {
    startTime = new Date().getTime();
    namePolling = "slowPoll";
  } else {
    namePolling = "fastPoll";
  }
  if (firstStart) {
    namePolling = "firstPoll";
  }
  sendPolling(namePolling);
}

function sendPolling(namePolling: PollName): void {
  if (authenticationFailed) {
    return;
  }
  const poll = PollCmd[namePolling][iteration];
  debug(
    "-----------------------------------------------------------------------------------------------------",
  );
  if (poll !== undefined) {
    debug(
      `* sendPolling. namePolling = ${namePolling} | iteration = ${iteration} | typeof poll = ${typeof poll} | poll = ${JSON.stringify(poll)}`,
    );
    if (typeof poll === "function") {
      poll();
      iterator(namePolling);
    } else if (states.api[poll.api].installed) {
      const api = poll.api;
      const method = poll.method;
      const params = poll.params;
      debug(
        `* Get info from (${namePolling}) api: ${api.toUpperCase()} method: ${method} params: ${JSON.stringify(params)}`,
      );
      if (!syno) {
        iterator(namePolling);
        return;
      }
      void (async () => {
        try {
          const res = await callSynology(syno, api, method, params);
          if (adapterUnloading) {
            return;
          }
          debug(
            res
              ? "* The response is received, parse:"
              : "* No response, read next.",
          );
          if (res) {
            if (!connectionEstablished) {
              adapter.log.info("Connection to Synology established");
              connectionEstablished = true;
            }
            if (!connect) {
              setInfoConnection(true);
            }
            connect = true;
            poll.ParseFunction(res as never, api as never);
          }
        } catch (err) {
          if (adapterUnloading) {
            return;
          }
          const message = err instanceof Error ? err.message : String(err);
          const errorCode =
            err instanceof SynologyClientError ? err.code : undefined;
          if (
            api === "ss" &&
            method === "getInfo" &&
            message.includes("version does not support")
          ) {
            adapter.log.warn(
              `sendPolling Error -${message} You are using a hacked version of SS?`,
            );
          } else if (
            (errorCode === 400 && message.includes("authentication failed")) ||
            errorCode === 403 ||
            (errorCode === 404 && message.includes("two-factor"))
          ) {
            authenticationFailed = true;
            timeOutReconnect && adapter.clearTimeout(timeOutReconnect);
            timeOutReconnect = null;
            timeOutPoll && adapter.clearTimeout(timeOutPoll);
            setInfoConnection(false);
            connect = false;
            adapter.log.warn(
              `${message}. Polling stopped; check the credentials and two-factor secret, then restart the adapter.`,
            );
          } else {
            error(`*sendPolling syno[${api}][${method}]`, err);
          }
          if (method === "getPollingData" || method === "listPackages") {
            iteration = -1;
          }
        } finally {
          if (!adapterUnloading) {
            if (isTwoFactorEnabled() && firstStart && !timeOutReconnect) {
              timeOut && adapter.clearTimeout(timeOut);
              timeOut = adapter.setTimeout(() => {
                iterator(namePolling);
              }, 30000);
            } else if (!timeOutReconnect) {
              iterator(namePolling);
            }
          }
        }
      })();
    } else {
      debug(`* Packet ${poll.api.toUpperCase()} non installed, skipped`);
      iterator(namePolling);
    }
  } else {
    debug(`* Poll undefined > ${JSON.stringify(poll)}`);
    iterator(namePolling);
  }
}

function iterator(namePolling: PollName): void {
  iteration++;
  if (iteration > PollCmd[namePolling].length - 1) {
    iteration = 0;
    timeOutPoll && adapter.clearTimeout(timeOutPoll);
    if (namePolling === "firstPoll") {
      firstStart = false;
      adapter.log.info("FirstStart polling completed");
      firstStartInfoStatePromise
        .then(() => setObject("info.firstStartCompleted", true))
        .catch((err) => {
          adapter.log.warn(`Cannot update first-start status: ${err.message}`);
        });
    }
    debug(
      "-----------------------------------------------------------------------------------------------------",
    );
    debug(">>>>>>>>>>>>>>> Read all data, save received data.");
    setStates();
    timeOutPoll = adapter.setTimeout(() => {
      endTime = new Date().getTime();
      queuePolling();
    }, pollTime);
  } else {
    sendPolling(namePolling);
  }
}

type SendCallback = (response: unknown) => void;

function send(
  api: "dsm" | "fs" | "dl" | "as" | "vs" | "dtv" | "ss",
  method: string,
  params?: Record<string, unknown> | SendCallback | null,
  cb?: SendCallback,
): void {
  if (typeof params === "function") {
    cb = params;
    params = null;
  }
  if (!syno) {
    cb?.(false);
    return;
  }
  void callSynology(syno, api, method, params)
    .then((data) => {
      const binary = toBuffer(data);
      const response = binary
        ? `${binary.byteLength} binary bytes`
        : JSON.stringify(data);
      debug(
        `Send [${api.toUpperCase()}] [${method}] Error: [no error] Response: [${response}]`,
      );
      cb?.(data || "");
    })
    .catch((err: unknown) => {
      if (adapterUnloading) {
        return;
      }
      debug(
        `Send [${api.toUpperCase()}] [${method}] Error: [${formatUnknown(err)}]`,
      );
      if (
        (method === "getSnapshotCamera" ||
          method === "getLiveViewPathCamera") &&
        err instanceof SynologyClientError &&
        err.code === 400
      ) {
        cb && cb(err);
      } else if (method === "getLiveViewPathCamera") {
        error(`function send: [${api}][${method}]`, err);
        cb && cb(false);
      } else if (method === "getStatusRemotePlayerStatus") {
        cb && cb(false);
      } else {
        error(`function send: [${api}][${method}]`, err, () => {
          cb && cb(false);
        });
      }
    });
}

type SshCallback = (stdout: string, exitCode: number, stderr: unknown) => void;

function sendSSH(method: string, cb?: SshCallback, nonFatal = false): void {
  let completed = false;
  try {
    const ssh = new SimpleSSH({
      host: adapter.config.host,
      port: adapter.config.ssh_port || 22,
      user: adapter.config.login,
      pass: adapter.config.password,
    });

    // substitute single ' with '"'"' - 'aaa'bbb' -> 'aaa'"'"'bbb' using string concat
    //const pwd= adapter.config.password.replaceAll("'", "\'\"\'\"\'"); - replaceAll requires node.15
    const pwd = adapter.config.password.replace(/'/g, "'\"'\"'");
    const sshcmd = `echo '${pwd}'|sudo -S ${method}`;
    const sshcmd4log = `echo '******'|sudo -S ${method}`;
    debug(`SSH:${sshcmd4log}`);
    ssh
      .exec(sshcmd, {
        err: (err: string) => {
          const filteredStderr = filterSshStderr(err);
          if (!filteredStderr) {
            return;
          }
          if (nonFatal) {
            debug(`SSH command stderr: ${filteredStderr}`);
          } else {
            error("SSH Error:", filteredStderr);
          }
        },
        exit: (code: number, stdout: string, stderr: string) => {
          if (!completed) {
            completed = true;
            cb && cb(stdout, code, stderr);
          }
        },
      })
      .start({
        fail: (err: Error) => {
          if (completed) {
            return;
          }
          completed = true;
          if (nonFatal) {
            adapter.log.warn(`SSH connection failed: ${String(err)}`);
            cb && cb("", -1, err);
          } else {
            error("SSH Error:", err);
          }
        },
      });
  } catch (e) {
    if (nonFatal && !completed) {
      completed = true;
      adapter.log.warn(`SSH command failed: ${String(e)}`);
      cb && cb("", -1, e);
    } else {
      error("--- SSH Error ", JSON.stringify(e));
    }
  }
}

async function setStates(): Promise<void> {
  debug("setStates");
  const currentStates = states as unknown as Record<
    string,
    Record<string, unknown>
  >;
  const previousStates = old_states as unknown as Record<
    string,
    Record<string, unknown>
  >;
  let ids = "";
  for (const _api of Object.keys(currentStates)) {
    if (_api !== "api") {
      const currentApi = currentStates[_api];
      const previousApi = previousStates[_api];
      for (const _type of Object.keys(currentApi)) {
        const currentType = currentApi[_type];
        const previousType = previousApi[_type];
        if (
          typeof currentType === "object" &&
          currentType !== null &&
          typeof previousType === "object" &&
          previousType !== null
        ) {
          const currentEntries = currentType as Record<string, unknown>;
          const previousEntries = previousType as Record<string, unknown>;
          for (const key of Object.keys(currentEntries)) {
            const currentValue = currentEntries[key];
            const previousValue = previousEntries[key];
            if (typeof currentValue === "object" && currentValue !== null) {
              const currentItem = currentValue as Record<string, unknown>;
              const previousItem =
                typeof previousValue === "object" && previousValue !== null
                  ? (previousValue as Record<string, unknown>)
                  : {};
              if (previousItem !== previousValue) {
                previousEntries[key] = previousItem;
              }
              for (const key2 of Object.keys(currentItem)) {
                if (
                  _api === "DiskStationManager" &&
                  _type === "hdd_info" &&
                  key2 === "smart"
                ) {
                  const channelId = `${_api}.${_type}.${key}.smart`;
                  if (!verifiedChannels.has(channelId)) {
                    await adapter.extendObjectAsync(channelId, {
                      type: "channel",
                      common: { name: "SMART" },
                      native: {},
                    });
                    verifiedChannels.add(channelId);
                  }
                  const currentSmart = currentItem.smart as
                    Record<string, unknown> | undefined;
                  if (!currentSmart) {
                    continue;
                  }
                  const previousSmart = (previousItem.smart ??= {}) as Record<
                    string,
                    unknown
                  >;
                  for (const attribute of Object.keys(currentSmart)) {
                    if (currentSmart[attribute] !== previousSmart[attribute]) {
                      previousSmart[attribute] = currentSmart[attribute];
                      await setObject(
                        `${channelId}.${attribute}`,
                        currentSmart[attribute],
                      );
                    }
                  }
                  continue;
                }
                //adapter.log.error('*********' + states[_api][_type][key][key2]);
                if (
                  !Object.prototype.hasOwnProperty.call(previousEntries, key)
                ) {
                  previousEntries[key] = {};
                }
                if (currentItem[key2] !== previousItem[key2]) {
                  previousItem[key2] = currentItem[key2];
                  ids = `${_api}.${_type}.${key}.${key2}`;
                  await setObject(ids, currentItem[key2]);
                }
              }
            } else {
              if (currentValue !== previousValue) {
                previousEntries[key] = currentValue;
                ids = `${_api}.${_type}.${key}`;
                await setObject(ids, currentValue);
              }
            }
          }
        } else {
          if (currentType !== previousType) {
            previousApi[_type] = currentType;
            ids = `${_api}.${_type}`;
            await setObject(ids, currentType);
          }
        }
      }
    }
  }
}

async function setObject(id: string, val: unknown): Promise<void> {
  debug(`setObject ${JSON.stringify(id)}, val=${formatUnknown(val)}`);
  if (!verifiedObjects[id]) {
    let obj = null;
    try {
      obj = await adapter.getObjectAsync(id);
    } catch {
      // ignore
    }
    const common: StateMetadata & { desc: string } = {
      name: id,
      desc: id,
      type: "string",
      role: "state",
    };
    let hasScopedMetadata = false;
    const objectId = id.split(".").pop() ?? id;
    if (objects[objectId] !== undefined) {
      common.name = objects[objectId].name;
      common.desc = objects[objectId].name;
      common.role = objects[objectId].role;
      common.type = objects[objectId].type;
      if (objects[objectId].unit !== undefined) {
        common.unit = objects[objectId].unit;
      }
      if (objects[objectId].min !== undefined) {
        common.min = objects[objectId].unit;
      }
      if (objects[objectId].max !== undefined) {
        common.max = objects[objectId].unit;
      }
      if (objects[objectId].states !== undefined) {
        common.states = objects[objectId].states;
      }
      common.read = objects[objectId].read;
      common.write = objects[objectId].write;
      //common.def = objects[_id].val;
    }
    const smartAttribute =
      id.startsWith("DiskStationManager.hdd_info.") && id.includes(".smart.")
        ? smartAttributeMetadata[
            objectId as keyof typeof smartAttributeMetadata
          ]
        : undefined;
    if (smartAttribute) {
      Object.assign(common, smartAttribute, { read: true, write: false });
    }
    if (id.includes("FileStation.info.items.")) {
      common.type = "object";
    }
    if (id.startsWith("DiskStationManager.vol_info.")) {
      const field = id.split(".").pop();
      if (field === "name" || field === "desc") {
        common.role = "text";
        common.type = "string";
        hasScopedMetadata = true;
      } else if (field === "status") {
        common.role = "info.status";
        common.type = "string";
        hasScopedMetadata = true;
      }
    }
    if (
      id.startsWith("DiskStationManager.info.") ||
      id.startsWith("FileStation.info.")
    ) {
      if (id.endsWith(".hostname")) {
        common.role = "info.name";
        hasScopedMetadata = true;
      }
    }
    if (
      id.startsWith("DownloadStation.info.") &&
      id.endsWith(".version_string")
    ) {
      common.role = "text";
      hasScopedMetadata = true;
    }
    if (id.startsWith("SurveillanceStation.cameras.")) {
      const field = id.split(".").pop();
      if (field === "enabled") {
        common.role = "switch.enable";
        hasScopedMetadata = true;
      }
    }
    if (
      val !== null &&
      val !== undefined &&
      common.type === "string" &&
      common.type !== typeof val
    ) {
      common.type = typeof val as StateValueType;
    }
    verifiedObjects[id] = common.type;
    try {
      if (!obj) {
        await adapter.extendObjectAsync(id, {
          type: "state",
          common: common as ioBroker.StateCommon,
          native: {},
        });
      } else {
        if (
          JSON.stringify(obj.common) !== JSON.stringify(common) &&
          (objects[objectId] !== undefined ||
            smartAttribute ||
            hasScopedMetadata)
        ) {
          await adapter.extendObjectAsync(id, {
            common: common as ioBroker.StateCommon,
          });
        }
        if (objectId === "player_name") {
          const ids = id.split(".").slice(0, -1).join(".");
          await adapter.extendObjectAsync(ids, {
            type: "channel",
            common: {
              name: String(val),
              type: "state",
            } as ioBroker.ChannelCommon,
            native: { id: val },
          });
        }
      }
    } catch (err) {
      adapter.log.warn(`Object creation for ${id} nt possible: ${String(err)}`);
    }
  }
  if (
    verifiedObjects[id] === "object" &&
    val !== null &&
    val !== undefined &&
    typeof val !== "string"
  ) {
    val = JSON.stringify(val);
  } else if (
    (val !== null && val !== undefined && verifiedObjects[id] !== typeof val) ||
    val
  ) {
    if (verifiedObjects[id] === "boolean") {
      val = !!val;
    } else if (verifiedObjects[id] === "string") {
      val = formatUnknown(val);
    } else if (verifiedObjects[id] === "number") {
      val = parseFloat(formatUnknown(val));
    } else {
      adapter.log.info(
        `Unexpected value type for ${id}: Expected=${verifiedObjects[id]}, Value=${typeof val}`,
      );
    }
  }
  await adapter.setStateAsync(id, {
    val: val as ioBroker.StateValue,
    ack: true,
  });
}

function error(src: string, e: unknown, cb?: (error: unknown) => void): void {
  const errorValue =
    typeof e === "object" && e !== null
      ? (e as { code?: number | string; message?: unknown })
      : undefined;
  const code = errorValue?.code;
  const message = errorValue?.message ?? e;
  const authenticationError =
    (code === 400 && String(message).includes("authentication failed")) ||
    code === 403 ||
    (code === 404 && String(message).includes("two-factor"));
  if (!~src.indexOf("getSongCover")) {
    const logLevel =
      src === "SSH Error:" || src === "--- SSH Error " ? "warn" : "debug";
    adapter.log[logLevel](
      `*** ERROR : src: ${src || "unknown"} code: ${code} message: ${formatUnknown(message)}`,
    );
  }
  if (authenticationError) {
    authenticationFailed = true;
    timeOutReconnect && adapter.clearTimeout(timeOutReconnect);
    timeOutReconnect = null;
    timeOutPoll && adapter.clearTimeout(timeOutPoll);
    setInfoConnection(false);
    connect = false;
    adapter.log.warn(
      "Synology authentication failed. Check the credentials and two-factor secret; polling stopped until the adapter is restarted.",
    );
    cb && cb(e);
    return;
  }
  if (
    code === 400 ||
    code === 106 ||
    code === 107 ||
    (typeof code === "number" && code >= 500) ||
    [
      "ECONNREFUSED",
      "ECONNRESET",
      "ETIMEDOUT",
      "EHOSTUNREACH",
      "ENOTFOUND",
      "EAI_AGAIN",
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_SOCKET",
    ].includes(String(code)) ||
    (code === 404 && String(message).includes("two-factor"))
  ) {
    timeOutReconnect && adapter.clearTimeout(timeOutReconnect);
    timeOutPoll && adapter.clearTimeout(timeOutPoll);
    if (connectionEstablished) {
      adapter.log.info("Connection to Synology lost");
      connectionEstablished = false;
    }
    setInfoConnection(false);
    connect = false;
    adapter.log.debug("Error: Reconnection after 30s");
    timeOutReconnect = adapter.setTimeout(() => {
      timeOutReconnect = null;
      newSyno();
    }, 30000);
  } else {
    cb && cb(e);
  }
}

function toPositiveInt(value: unknown, defaultValue: number): number {
  const num = parseInt(String(value), 10);
  return Number.isNaN(num) || num <= 0 ? defaultValue : num;
}

function main(): void {
  if (!adapter.systemConfig) {
    return;
  }
  adapter.subscribeStates("*");
  setInfoConnection(false);
  firstStartInfoStatePromise = setObject(
    "info.firstStartCompleted",
    false,
  ).catch((err) => {
    adapter.log.warn(`Cannot create first-start status: ${err.message}`);
  });
  old_states = JSON.parse(JSON.stringify(states));
  const configuredPollTime = Number(adapter.config.polling);
  if (Number.isFinite(configuredPollTime) && configuredPollTime < 1000) {
    adapter.config.polling = 1000;
    void adapter
      .extendForeignObjectAsync(`system.adapter.${adapter.namespace}`, {
        native: { polling: 1000 },
      })
      .catch((err) => {
        adapter.log.warn(`Could not correct polling interval: ${String(err)}`);
      });
  }
  pollTime = toPositiveInt(adapter.config.polling, 10000);
  slowPollingTime = toPositiveInt(adapter.config.slowPollingTime, 60000);
  if (pollTime > slowPollingTime) {
    adapter.log.warn(
      "pollTime > slowPollingTime! It is necessary to fix the polling time in the settings",
    );
  }
  if (
    parseInt(adapter.config.version, 10) < 6 ||
    parseInt(adapter.config.version, 10) >= 7
  ) {
    PollCmd.firstPoll[0] = {
      api: "dsm",
      method: "listPackages",
      params: { version: 1 },
      ParseFunction: parseInstallingPackets,
    };
  }
  if (!adapter.config.ss || !adapter.config.dl || !adapter.config.as) {
    let result;
    result = PollCmd.fastPoll.filter((item) => {
      if (typeof item === "function") {
        return item.name !== "getStatusPlayer" || !!adapter.config.as;
      }
      return !(
        (item.api === "ss" && !adapter.config.ss) ||
        (item.api === "dl" && !adapter.config.dl) ||
        (item.api === "as" && !adapter.config.as)
      );
    });
    PollCmd.fastPoll = result;

    result = PollCmd.slowPoll.filter((item) => {
      if (typeof item === "function") {
        return (
          !["addLinkSnapShot", "getLiveViewPathCamera"].includes(item.name) ||
          !!adapter.config.ss
        );
      }
      return !(
        item.api === "ss" ||
        (item.api === "dl" && !adapter.config.dl) ||
        (item.api === "as" && !adapter.config.as)
      );
    });
    PollCmd.slowPoll = result;
  }
  // const dirOld = `${utils.controllerDir}/${adapter.systemConfig.dataDir}${adapter.namespace.replace('.', '_')}/`;
  const pathInstance = `${adapter.namespace.replace(".", "_")}/`;
  dir = path.join(utils.getAbsoluteDefaultDataDir(), pathInstance);
  debug(`working directory is ${dir}`);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }
  adapter.writeFile(
    adapter.namespace,
    "cover.png",
    fs.readFileSync(path.join(__dirname, "../admin/cover.png")),
    (err) => {
      if (err) {
        error("write cover", err);
      }
    },
  );
  void migrateLegacyTwoFactorSetting().then(newSyno);
}

async function migrateLegacyTwoFactorSetting(): Promise<void> {
  if (adapter.config.twofa_checkbox !== true) {
    return;
  }

  adapter.config["2fa_checkbox"] = true;
  adapter.config.twofa_checkbox = false;
  try {
    await adapter.extendForeignObjectAsync(
      `system.adapter.${adapter.namespace}`,
      {
        native: {
          "2fa_checkbox": true,
          twofa_checkbox: false,
        },
      },
    );
  } catch (err) {
    adapter.log.warn(
      `Could not persist legacy two-factor setting migration: ${String(err)}`,
    );
  }
}

function newSyno(): void {
  startTime = new Date().getTime();
  endTime = new Date().getTime();
  adapter.log.debug(
    `Connecting to Synology ${adapter.config.host}:${adapter.config.port}`,
  );
  syno = null;
  const previousClose = closeSynologyClient;
  closeSynologyClient = undefined;
  if (previousClose) {
    void previousClose().catch((err: unknown) => {
      adapter.log.debug(
        `Could not close previous Synology connection: ${String(err)}`,
      );
    });
  }
  authenticationFailed = false;
  firstStart = true;
  try {
    const client = createSynologyClient({
      ignoreCertificateErrors: true,
      host: adapter.config.host || "127.0.0.1",
      port: Number(adapter.config.port) || 5000,
      account: adapter.config.login || "admin",
      passwd: adapter.config.password || "",
      protocol: adapter.config.https ? "https" : "http",
      apiVersion: resolveApiVersion(String(adapter.config.version || "6.2.2")),
      twoFactorEnabled: isTwoFactorEnabled(),
      twoFactorSecret:
        adapter.config["2fa_code"] || adapter.config.twofa_code || undefined,
    });
    syno = client.client;
    closeSynologyClient = client.close;
    adapter.log.debug("FirstStart polling started");
    queuePolling();
  } catch (e) {
    adapter.log.error(`Cannot initialize Synology client: ${formatUnknown(e)}`);
  }
}

function isTwoFactorEnabled(): boolean {
  const configuredValue = adapter.config["2fa_checkbox"];
  if (typeof configuredValue === "boolean") {
    return configuredValue;
  }
  return adapter.config.twofa_checkbox === true;
}

function setInfoConnection(val: boolean): void {
  adapter.getState("info.connection", function (err, state) {
    if (!err && state != null) {
      if (state.val === val) {
        // ignore
      } else if (state.val !== val) {
        adapter.setState("info.connection", val, true);
      }
    } else if (!state && !err) {
      adapter.setState("info.connection", val, true);
    }
  });
}

function rePollAfterCmd(): void {
  timeOutPoll && adapter.clearTimeout(timeOutPoll);
  setInfoConnection(false);
  connect = false;
  endTime = new Date().getTime();
  queuePolling();
}

function isInstalled(fullName: string): PollApi | false {
  for (const api in states.api) {
    if (!Object.prototype.hasOwnProperty.call(states.api, api)) {
      continue;
    }
    if (states.api[api].name === fullName) {
      return api as PollApi;
    }
  }
  return false;
}

function debug(msg: string): void {
  adapter.log.debug(msg);
}
function info(msg: string): void {
  adapter.log.info(msg);
}
function warn(msg: string): void {
  adapter.log.warn(msg);
}

function unixToDate(timestamp: number): string {
  return moment.unix(timestamp).format("DD/MM/YYYY, HH:mm");
}
/*
const dateToUnix = (date) => {
    const ts = moment(date).unix();
    return moment.unix(ts);
};
*/
function secToText(sec: number): string {
  let res;
  let m = Math.floor(sec / 60);
  const s = sec % 60;
  const h = Math.floor(m / 60);
  m = m % 60;
  if (h > 0) {
    res = `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
  } else {
    res = `${pad2(m)}:${pad2(s)}`;
  }
  return res;
}

function pad2(num: number): string {
  const s = num.toString();
  return s.length < 2 ? `0${s}` : s;
}

if (module.parent) {
  module.exports = startAdapter;
} else {
  startAdapter();
}
