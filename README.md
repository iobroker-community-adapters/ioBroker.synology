![Logo](admin/synology.png)
# ioBroker Synology adapter

![Number of Installations](http://iobroker.live/badges/synology-installed.svg)
![Number of Installations](http://iobroker.live/badges/synology-stable.svg)
[![NPM version](http://img.shields.io/npm/v/iobroker.synology.svg)](https://www.npmjs.com/package/iobroker.synology)

![Test and Release](https://github.com/iobroker-community-adapters/ioBroker.synology/workflows/Test%20and%20Release/badge.svg)
[![Translation status](https://weblate.iobroker.net/widgets/adapters/-/synology/svg-badge.svg)](https://weblate.iobroker.net/engage/adapters/?utm_source=widget)
[![Downloads](https://img.shields.io/npm/dm/iobroker.synology.svg)](https://www.npmjs.com/package/iobroker.synology)

**This adapter uses Sentry libraries to automatically report exceptions and code errors to the developers.** For more details and for information how to disable the error reporting see [Sentry-Plugin Documentation](https://github.com/ioBroker/plugin-sentry#plugin-sentry)! Sentry reporting is used starting with js-controller 3.0.


## Description
The driver allows you to receive data and manage your Synology NAS server.

### 2FA Settings

If you use 2FA in DSM6/7 see instructions [here](docs/en/template.md)

### Important note for Windows Installations

This adapter requires git to be installed at the hist system. Installation media can be found at https://git-scm.com/download/win.

### Reboot and Shutdown
The adapter will do this via SSH since v2.1.4, so please set the SSH port in the adapter setttings. You can see it in the Synology settings:
![grafik](https://user-images.githubusercontent.com/6681528/161436776-bd04b0c6-cfb2-47ab-9bee-7ea700575bbb.png)
![grafik](https://user-images.githubusercontent.com/6681528/161436897-174f3396-c2bb-4248-b91c-707005f7d2a8.png)


### sendMethod

You can send any command (method) by setting the sendMethod object, for example:
Get the SurveillanceStation info is a getInfo method with no additional parameters.

```{"method": "getInfo", "params": {}}```

### Control
**commands.reboot** - reboot NAS

**commands.wake** - send Wake On Lan to NAS

**commands.shutdown** - shutdown NAS

***SurveillanceStation.cameras.{NAMECAM}***:
* enabled - Current status and enable/disable camera
* linkSnapshot - URL for snapshot

***SurveillanceStation.HomeMode.status_on*** - Current status and enable/disable homemode

***SurveillanceStation.getSnapshotCamera*** - Get snapshot by camera number, the file is saved in a directory ``...iobroker-data\synology_0\snapshotCam_2.jpg``

***AudioStation.players.{PLAYERID}***:
* play, pause, stop, next, prev - Controlling playback (button, only true)
* repeat - Repeat control (Off, All, One)
* shuffle - Shuffle control (true/false)
* volume - Volume remote player (0-100) 
* seek - Controlling playback seek (0-100)
* play_folder - Add tracks from the folder to the playlist (id folder e.g. ``dir_5816``)
* play_track - Play track by its id (e.g. ``music_120847``)
* current_play - Control and status of the current track by its number in the playlist (e.g. ``14``)

***DownloadStation***:
* activeTask - number of incomplete downloads
* listTasks - an array with incomplete downloads
* shedule_enabled, shedule_emule_enabled - Status and control of scheduled or immediate downloads
* add_hash_download - add to Hash Downloads (e.g. ``8BD3CAD02FC9ECB661A12378414FA310D3F3FE03``)
* add_url_download - add download URL or magnet link
* folder - The folder to download, set before adding the download, otherwise it is loaded into the default folder
* pause_task, resume_task - Pause the download and resume. (e.g. ``dbid_170`` or ``170`` or ``all``)

### Messagebox
```
sendTo('synology.0', 'getSnapshot', {camId: 2}, (res) => {
    if(res) sendTo('telegram.0', {text: res, caption: 'caption for image'});
});
```

## Changelog
### **WORK IN PROGRESS**
- (GermanBluefox) Fixed crash when polling interval is stored as string (#559)
- (Voodoo2man) Fixed object state defaults and raised saved polling intervals below 1000 ms to 1000 ms.
- (Voodoo2man) Removed unpublished release news and obsolete tooling, and migrated Admin translations.

### 3.3.2 (2026-10-23)
- (Voodoo2man) Migrated the adapter to TypeScript, preserved legacy 2FA settings, and configured runtime builds during npm deployment.

### 3.3.1 (2026-10-18)
- (Voodoo2man) Improved polling defaults, connection logging, and handling of invalid credentials.
- (Voodoo2man) Filtered harmless SSH notices and bound timers to the adapter lifecycle.
- (Voodoo2man) Corrected semantic roles for system, volume, download, and surveillance states.
- (Voodoo2man) Corrected the hard disk capacity state role.
- (Voodoo2man) Migrated linting to ESLint 9 with the ioBroker standard configuration.

### 3.3.0 (2026-10-17)
- (Voodoo2man) Added a guarded FFmpeg fallback for H.265 camera snapshots.
- (Voodoo2man) Added optional SMART attribute polling over SSH.
- (Voodoo2man) Changed SSH error logging from debug to warn.

### 3.2.1 (2026-10-16)
- (Voodoo2man) Rebuild the snapshot link immediately when a camera ID changes.

### 3.2.0 (2026-10-16)
- (copilot) Adapter requires node.js >= 22 now
- (copilot) Adapter requires admin >= 7.7.22 now
- (copilot) Adapter requires js-controller >= 6.0.11 now
* (McM1957) Dependencies have been updated.

[Older changelogs can be found there](CHANGELOG_OLD.md)

## License
The MIT License (MIT)

Copyright (c) 2024-2026 iobroker-community-adapters <iobroker-community-adapters@gmx.de>  
Copyright (c) 2021-2023 instalator <vvvalt@mail.ru>, ioBroker Community-Developers

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
