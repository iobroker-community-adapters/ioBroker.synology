"use strict";
const utils = require('@iobroker/adapter-core');
let Syno = require('syno');
const fs = require('fs');
const moment = require('moment');
let adapter, syno, timeOutPoll, timeOutRecconect, pollTime, connect = false, iteration = 0, queueCmd = null, startTime, endTime,
    firstStart = true, slowPollingTime, dir, old_states, timeOut, pathInstance;
const stateSS = {
    recStatus:  {
        0: 'None recording schedule',
        1: 'Continue recording schedule',
        2: 'Motion detect recording schedule',
        3: 'Digital input recording schedule',
        4: 'Digital input recording schedule',
        5: 'Manual recording schedule',
        6: 'External',
        7: 'Analytics'
    },
    videoCodec: {
        0: 'Unknown',
        1: 'MJPEG',
        2: 'MPEG4',
        3: 'H264',
        5: 'MXPEG',
        6: 'H265',
        7: 'H264+'
    },
    camStatus:  {
        1:  'Normal',
        2:  'Deleted',
        3:  'Disconnected',
        4:  'Unavailable',
        5:  'Ready',
        6:  'Inaccessible',
        7:  'Disabled',
        8:  'Unrecognized',
        9:  'Setting',
        10: 'Server disconnected',
        11: 'Migrating',
        12: 'Others',
        13: 'Storage removed',
        14: 'Stopping',
        15: 'Connect hist failed',
        16: 'Unauthorized',
        17: 'RTSP error',
        18: 'No video'
    }
};

function startAdapter(options){
    return adapter = utils.adapter(Object.assign({}, options, {
        systemConfig: true,
        name:         'synology',
        ready:        main,
        unload:       callback => {
            timeOutPoll && clearTimeout(timeOutPoll);
            timeOutRecconect && clearTimeout(timeOutRecconect);
            timeOut && clearTimeout(timeOut);
            try {
                debug('cleaned everything up...');
                callback();
            } catch (e) {
                callback();
            }
        },
        stateChange:  (id, state) => {
            if (id && state && !state.ack && !firstStart){
                debug(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
                let ids = id.split(".");
                let name = ids[ids.length - 2].toString();
                let command = ids[ids.length - 1].toString();
                let val = state.val;
                if (command === 'reboot'){
                    send('dsm', 'rebootSystem', (res) => {
                        debug('System reboot');
                        rePollAfterCmd();
                    });
                } else if (command === 'shutdown'){
                    send('dsm', 'shutdownSystem', (res) => {
                        debug('System shutdown');
                        rePollAfterCmd();
                    });
                } else if (command === 'Browser'){  /*  /AS  */
                    if (name in states.AudioStation.players){
                        queueCmd = true;
                        Browser(name, val);
                    } else {
                        error('Browser', 'Error player ' + name + ' offline?');
                    }
                } else if (command === 'play_folder'){
                    PlayFolder(name, val);
                } else if (command === 'play_track'){
                    PlayTrack(name, val);
                } else if (command === 'song_id'){
                    PlayTrackId(name, val);
                } else if (command === 'current_play'){
                    PlayTrackNum(name, val);
                } else if (command === 'clearPlaylist'){
                    clearPlaylist(name);
                } else if (command === 'stop' || command === 'next' || command === 'prev' || command === 'volume' || command === 'seek' || command === 'pause' || command === 'play' || command === 'repeat' || command === 'shuffle'){
                    PlayControl(name, command, val);
                } else if (command === 'getSnapshotCamera'){
                    getSnapshotCamera(val);
                } else if (command === 'add_url_download' || command === 'add_hash_download'){
                    addDownload(command, val);
                } else if (command === 'shedule_emule_enabled' || command === 'shedule_enabled'){
                    setConfigSchedule(command, val);
                } else if (command === 'pause_task' || command === 'resume_task'){
                    pauseTask(command, val);
                } else if (command === 'enabled'){
                    switchCam(name, command, val);
                } else if (command === 'status_on'){
                    send('ss', 'switchHomeMode', {on: val});
                } else if (command === 'sendMethod'){
                    sendMethod(name, val);
                } else if (name === 'sharing' && command === 'create'){
                    CreateSharing(command, val);
                } else if (name === 'sharing' && command === 'delete'){
                    DeleteSharing(command, val);
                } else if (name === 'sharing' && command === 'clear_invalid'){
                    send('fs', 'Clear_invalidSharing', {}, () => {
                        debug('Remove all expired and broken sharing links.');
                    });
                }
            }
        },
        message:      obj => {
            if (typeof obj === 'object' && obj.command){
                debug(`message ******* ${JSON.stringify(obj)}`);
                if (obj.command === 'getSnapshot' && obj.message.camId){
                    getSnapshotCamera(parseInt(obj.message.camId, 10), (res) => {
                        obj.callback && adapter.sendTo(obj.from, obj.command, res, obj.callback);
                    });
                }
            } else {
                debug(`message x ${obj.command}`);
            }
        }
    }));
}

let states = {
    DiskStationManager:  {info: {}, hdd_info: {}, vol_info: {}},
    FileStation:         {info: {}, sharing: {}},
    DownloadStation:     {info: {}},
    AudioStation:        {info: {}, players: {}},
    VideoStation:        {info: {}},
    VideoStation_DTV:    {info: {}},
    SurveillanceStation: {info: {}, cameras: {}, HomeMode: {}},
    api:                 {
        dsm: {name: 'DiskStationManager', installed: true},
        fs:  {name: 'FileStation', installed: true},
        dl:  {name: 'DownloadStation', installed: false},
        as:  {name: 'AudioStation', installed: false},
        vs:  {name: 'VideoStation', installed: false},
        dtv: {name: 'dtVideoStation_DTV', installed: false},
        ss:  {name: 'SurveillanceStation', installed: false}
    }
};

const objects = {
    current_duration: {role: "media.duration.text", name: "Playback duration", type: "string", read: true, write: false},
    current_elapsed:  {role: "media.elapsed.text", name: "Playback elapsed", type: "string", read: true, write: false},
    current_play:     {role: "media.track", name: "Controlling and state current play track number", type: "number", read: true, write: true},
    song_id:          {role: "media.playid", name: "Controlling and state current play track id", type: "number", read: true, write: true},
    artist:           {role: "media.artist", name: "Artist", type: "string", read: true, write: false},
    album:            {role: "media.album", name: "Album", type: "string", read: true, write: false},
    title:            {role: "media.title", name: "Title", type: "string", read: true, write: false},
    cover:            {role: "media.cover", name: "Media cover (eg. http://{ip}:8082/{state})", type: "string", read: true, write: false},
    genre:            {role: "media.genre", name: "Genre", type: "string", read: true, write: false},
    year:             {role: "media.date", name: "Year", type: "number", read: true, write: false},
    path:             {role: "media", name: "Path track", type: "string", read: true, write: false},
    player_name:      {role: "media", name: "Remote player name", type: "string", read: true, write: false},
    playlist_total:   {role: "media", name: "Number of tracks in the playlist", type: "number", read: true, write: false},
    duration_sec:     {role: "media.duration", name: "Duration track in secunds", type: "number", read: true, write: false},
    duration:         {role: "media.duration.text", name: "Duration track", type: "string", read: true, write: false},
    bitrate:          {role: "media.bitrate", name: "bitrate", type: "string", unit: "kbps", read: true, write: false},
    seek:             {role: "media.seek", name: "Controlling playback seek", type: "number", unit: "%", min: 0, max: 100, read: true, write: true},
    volume:           {role: "level.volume", name: "Volume", type: "number", min: 0, max: 100, read: true, write: true},
    subplayer_volume: {role: "level.volume", name: "Subplayer volume if supported", type: "number", min: 0, max: 100, read: true, write: true},
    playlist:         {role: "media.playlist", name: "AudioStation playlist", type: "string", read: true, write: true},
    repeat:           {role: "media.mode.repeat", name: "Repeat control", type: "string", read: true, write: true, states: {none: "Off", all: "All", one: "One"}},
    shuffle:          {role: "media.mode.shuffle", name: "Shuffle control", type: "boolean", read: true, write: true},
    prev:             {role: "button.prev", name: "Controlling playback previous", type: "boolean", read: false, write: true},
    next:             {role: "button.next", name: "Controlling playback next", type: "boolean", read: false, write: true},
    stop:             {role: "button.stop", name: "Controlling playback stop", type: "boolean", read: false, write: true},
    pause:            {role: "button.pause", name: "Controlling playback pause", type: "boolean", read: false, write: true},
    play:             {role: "button.play", name: "Controlling playback play", type: "boolean", read: false, write: true},
    clearPlaylist:    {role: "button", name: "Clear current playlist", type: "boolean", read: false, write: true},
    state_playing:    {role: "media.state", name: "Status Play, stop, or pause", type: "string", read: true, write: false},
    online:           {role: "state", name: "Is player online", type: "boolean", read: true, write: false},
    memory_usage:     {role: "state", name: "Memory usage", type: "number", unit: "%", read: true, write: false},
    cpu_load:         {role: "state", name: "Cpu load", type: "number", unit: "%", read: true, write: false},
    used:             {role: "state", name: "Used", type: "number", unit: "%", read: true, write: false},
    ram:              {role: "state", name: "Ram", type: "number", unit: "MB", read: true, write: false},
    capacity:         {role: "state", name: "Capacity", type: "number", unit: "GB", read: true, write: false},
    total_size:       {role: "state", name: "Total size", type: "number", unit: "GB", read: true, write: false},
    used_size:        {role: "state", name: "Used size", type: "number", unit: "GB", read: true, write: false},
    temperature:      {role: "state", name: "Temperature", type: "number", unit: "°C", read: true, write: false},
    Browser:          {role: "media.browser", name: "AudioStation Browser Files", type: "string", read: true, write: true},
    play_folder:      {role: "media.add", name: "Add tracks from the folder to the playlist", type: "string", read: true, write: true},
    play_track:       {role: "state", name: "Play track by its id", type: "string", read: true, write: true},
    status_on:        {role: "state", name: "HomeMode status", type: "boolean", read: true, write: true},
    enabled:          {role: "state", name: "Is enabled", type: "boolean", read: true, write: true},
    favoriteRadio:    {role: "state", name: "Favorite playlist Radio", type: "string", read: true, write: false},
    motionDetected:   {role: "state", name: "Motion detected", type: "boolean", read: true, write: false},
};

let PollCmd = {
    "firstPoll": [
        {api: 'dsm', method: 'getPollingData', params: {}, ParseFunction: parseInstallingPackets}, // OR listPackages if < 6 in main function
        {api: 'dsm', method: 'getInfo', params: {}, ParseFunction: parseInfo},
        {api: 'fs', method: 'getInfo', params: {}, ParseFunction: parseInfo},
        {api: 'dl', method: 'getInfo', params: {}, ParseFunction: parseInfo},
        {api: 'as', method: 'getInfo', params: {}, ParseFunction: parseInfo},
        {api: 'vs', method: 'getInfo', params: {}, ParseFunction: parseInfo},
        {api: 'dtv', method: 'GetInfoTuner', params: {}, ParseFunction: parseInfo},
        {api: 'ss', method: 'getInfo', params: {}, ParseFunction: parseInfo},
        {api: 'ss', method: 'getInfoHomeMode', params: {need_mobiles: true}, ParseFunction: parseInfoHomeMode},
        {api: 'ss', method: 'listCameras', params: {basic: true, version: 7}, ParseFunction: parselistCameras},
        {api: 'as', method: 'listRemotePlayers', params: {type: 'all', additional: 'subplayer_list'}, ParseFunction: parseListRemotePlayers},
    ],
    "fastPoll":  [
        {api: 'dsm', method: 'getSystemUtilization', params: {}, ParseFunction: parseSystemUtilization},
        {api: 'dsm', method: 'getSystemStatus', params: {}, ParseFunction: parseSystemStatus},
        {api: 'dsm', method: 'getInfo', params: {}, ParseFunction: parseTempInfo},
        {api: 'dsm', method: 'infoSystem', params: {type: "storage", version: 1}, ParseFunction: parseInfoSystem},
        getStatusPlayer,
        {api: 'ss', method: 'getInfoHomeMode', params: {need_mobiles: true}, ParseFunction: parseInfoHomeMode},
        {api: 'ss', method: 'listCameras', params: {basic: true, version: 7}, ParseFunction: parselistCameras},
        {api: 'dl', method: 'getConfigSchedule', params: {}, ParseFunction: parsegetConfigSchedule},
        {api: 'fs', method: 'listSharings', params: {}, ParseFunction: parseListSharings},
    ],
    "slowPoll":  [
        {api: 'as', method: 'listRemotePlayers', params: {type: 'all', additional: 'subplayer_list'}, ParseFunction: parseListRemotePlayers},
        {api: 'dl', method: 'listTasks', params: {}, ParseFunction: parselistTasks},
        {api: 'as', method: 'listRadios', params: {container: 'Favorite', limit: 1000, library: 'shared', sort_direction: 'ASC'}, ParseFunction: parselistRadios},
        addLinkSnapShot,
        getLiveViewPathCamera
    ]
};
/************************ SurveillanceStation ***********************/

const getIdsCams = () => {
    let ids = [];
    Object.keys(states.SurveillanceStation.cameras).forEach((nameCam) => {
        if (nameCam !== undefined) ids.push(states.SurveillanceStation.cameras[nameCam].id);
    });
    return ids.join(',');
};

const getNameCams = (id) => {
    for (let nameCam in states.SurveillanceStation.cameras) {
        if (!states.SurveillanceStation.cameras.hasOwnProperty(nameCam)) continue;
        if (states.SurveillanceStation.cameras[nameCam].id === id){
            return nameCam;
        }
    }
};

function switchCam(name, command, val){
    let method = !!val ? 'enableCamera' :'disableCamera';
    if (name !== 'undefined'){
        let camId = states.SurveillanceStation.cameras[name].id.toString();
        send('ss', method, {cameraIds: camId, blIncludeDeletedCam: false, version: 7});
    }
}

function addLinkSnapShot(){
    debug('addLinkSnapShot');
    Object.keys(states.SurveillanceStation.cameras).forEach((nameCam) => {
        if (nameCam !== undefined){
            const camId = states.SurveillanceStation.cameras[nameCam].id;
            const _sid = syno.sessions.SurveillanceStation ? syno.sessions.SurveillanceStation._sid :'';
            states.SurveillanceStation.cameras[nameCam]['linkSnapshot'] = syno.protocol + '://' + syno.host + ':' + syno.port + '/webapi/entry.cgi?api=SYNO.SurveillanceStation.Camera&method=GetSnapshot&version=7&cameraId= ' + camId + '&_sid=' + _sid;
        }
    });
}

function getLiveViewPathCamera(){
    debug('getLiveViewPathCamera');
    const ids = getIdsCams();
    if (ids){
        send('ss', 'getLiveViewPathCamera', {idList: ids}, (res) => {
            if (res && !res.code && !res.message){
                res.forEach((obj) => {
                    const nameCam = getNameCams(obj.id);
                    states.SurveillanceStation.cameras[nameCam]['linkMjpegHttpPath'] = obj.mjpegHttpPath;
                    states.SurveillanceStation.cameras[nameCam]['linkMulticstPath'] = obj.multicstPath;
                    states.SurveillanceStation.cameras[nameCam]['linkMxpegHttpPath'] = obj.mxpegHttpPath;
                    states.SurveillanceStation.cameras[nameCam]['linkRtspOverHttpPath'] = obj.rtspOverHttpPath;
                    states.SurveillanceStation.cameras[nameCam]['linkRtspPath'] = obj.rtspPath;
                });
            }
        });
    }
}

function getSnapshotCamera(camid, cb){
    debug('getSnapshotCamera');
    const param = {cameraId: camid, preview: true, version: 7};
    send('ss', 'getSnapshotCamera', param, (res) => {
        if (res && !res.code && !res.message){
            let buf = Buffer.from(res, 'binary');
            fs.writeFile(dir + 'snapshotCam_' + camid + '.jpg', buf, (err) => {
                if (!err){
                    cb && cb(dir + 'snapshotCam_' + camid + '.jpg');
                } else {
                    cb && cb(false);
                    error('Write snapshot file Error: ', err);
                }
            });
        }
    });
}

function parselistEvents(res){
    debug('test - Response: ' + JSON.stringify(res));
    if (res.events.length > 0){
        res.events.forEach((event) => {
            states.SurveillanceStation.cameras[event.camera_name].motionDetected = true;
        });
    }
}

function parselistCameras(res){
    debug('listCameras - Response: ' + JSON.stringify(res));
    let arr = res.cameras;
    arr.forEach((k, i) => {
        if (arr[i].name){
            if (states.SurveillanceStation.cameras[arr[i].name] === undefined){
                states.SurveillanceStation.cameras[arr[i].name] = {};
            }
            states.SurveillanceStation.cameras[arr[i].name].host = arr[i].host || arr[i].ip;
            states.SurveillanceStation.cameras[arr[i].name].id = arr[i].id;
            states.SurveillanceStation.cameras[arr[i].name].port = arr[i].port;
            states.SurveillanceStation.cameras[arr[i].name].model = arr[i].model;
            states.SurveillanceStation.cameras[arr[i].name].vendor = arr[i].vendor;
            states.SurveillanceStation.cameras[arr[i].name].videoCodec = stateSS.videoCodec[arr[i].videoCodec];
            states.SurveillanceStation.cameras[arr[i].name].status = stateSS.camStatus[arr[i].status];
            states.SurveillanceStation.cameras[arr[i].name].recStatus = stateSS.recStatus[arr[i].recStatus];
            states.SurveillanceStation.cameras[arr[i].name].enabled = arr[i].enabled;
            states.SurveillanceStation.cameras[arr[i].name].motionDetected = false;
            states.SurveillanceStation.cameras[arr[i].name].motionDetected = arr[i].recStatus === 2;
        }
    });
}

function parseInfoHomeMode(res){
    debug('InfoHomeMode - Response: ' + JSON.stringify(res));
    states.SurveillanceStation.HomeMode['status_on'] = res.on;
    states.SurveillanceStation.HomeMode['notify_on'] = res.notify_on;
    states.SurveillanceStation.HomeMode['onetime_disable_on'] = res.onetime_disable_on;
    states.SurveillanceStation.HomeMode['onetime_disable_time'] = unixToDate(res.onetime_disable_time);
    states.SurveillanceStation.HomeMode['onetime_enable_on'] = res.onetime_enable_on;
    states.SurveillanceStation.HomeMode['onetime_enable_time'] = unixToDate(res.onetime_enable_time);
    states.SurveillanceStation.HomeMode['geo_lat'] = res.geo_lat;
    states.SurveillanceStation.HomeMode['geo_lng'] = res.geo_lng;
    states.SurveillanceStation.HomeMode['geo_radius'] = res.geo_radius;
    states.SurveillanceStation.HomeMode['wifi_ssid'] = res.wifi_ssid;
}

function parseSSInfo(res){
    states.SurveillanceStation.info.CMSMinVersion = res.CMSMinVersion;
    states.SurveillanceStation.info.cameraNumber = res.cameraNumber;
    states.SurveillanceStation.info.isLicenseEnough = res.isLicenseEnough;
    states.SurveillanceStation.info.liscenseNumber = res.liscenseNumber;
    states.SurveillanceStation.info.maxCameraSupport = res.maxCameraSupport;
    states.SurveillanceStation.info.enableVideoRelay = res.enableVideoRelay;
    states.SurveillanceStation.info.remindQuickconnectTunnel = res.remindQuickconnectTunnel;
    states.DiskStationManager.info.hostname = res.hostname;
    states.DiskStationManager.info.timezone = res.timezone;
    states.DiskStationManager.info.unique = res.unique;
    states.DiskStationManager.info.serviceVolSize = res.serviceVolSize;
    states.DiskStationManager.info.productName = res.productName;
}

/*********************** DownloadStation ************************/

function addDownload(command, url, cb){
    if (url){
        debug('addDownload');
        if (command === 'add_hash_download') url = 'magnet:?xt=urn:btih:' + url;
        let param = {type: "url", create_list: true, uri: [url], version: 2};
        adapter.getState('DownloadStation.folder', (err, state) => {
            if (!err && state) param.destination = state.val;
            send('dl', 'createTask', param, (res) => {
                if (res && res.message) error('addDownload Error: ', res.message);
                cb && cb();
            });
        });
    } else {
        error('addDownload', 'Link not set');
    }
}

function setConfigSchedule(command, val){
    debug('setConfigSchedule');
    let param;
    if (command === 'shedule_enabled'){
        param = {enabled: val};
    }
    if (command === 'shedule_emule_enabled'){
        param = {emule_enabled: val};
    }
    send('dl', 'setConfigSchedule', param, (res) => {
        if (res && res.message){
            error('setConfigSchedule Error: ', res.message);
        }
    });
}

function pauseTask(command, val){
    debug('pauseTask');
    let param, method, ids = [];
    if (!~val.toString().indexOf('dbid_') && val !== 'all'){
        param = {id: 'dbid_' + val};
    } else if (val === 'all'){
        try {
            const arr = JSON.parse(states.DownloadStation.listTasks);
            if (arr && arr.length > 0){
                arr.forEach((key) => {
                    ids.push(key.id);
                });
                param = {id: ids.join(',')};
            }
        } catch (e) {

        }
    } else {
        param = {id: val};
    }
    if (command === 'pause_task'){
        method = 'pauseTask';
    }
    if (command === 'resume_task'){
        method = 'resumeTask';
    }
    send('dl', method, param, (res) => {
        if (res && res.message){
            adapter.log.error('pauseTask Error: ' + res.message);
        }
    });
}

function parsegetConfigSchedule(res){
    debug('getConfigSchedule - Response: ' + JSON.stringify(res));
    if (res && !res.message){
        states.DownloadStation['shedule_emule_enabled'] = res.emule_enabled;
        states.DownloadStation['shedule_enabled'] = res.enabled;
    }
}

function parselistTasks(res){
    debug('listTasks - Response: ' + JSON.stringify(res));
    if (res && !res.message){
        let task = [];
        res.tasks.forEach((obj) => {
            if (obj.status !== 'finished'){
                task.push(obj);
            }
        });
        states.DownloadStation['listTasks'] = JSON.stringify(task);
        states.DownloadStation['activeTask'] = task.length;
    }
}

/************************* AudioStation *************************/

function clearPlaylist(playerid, cb){
    const param = {
        id:            playerid,
        offset:        0,
        songs:         '',
        limit:         states.AudioStation.players[playerid].playlist_total || 10000,
        updated_index: -1
    };
    send('as', 'updatePlayListRemotePlayer', param, () => {
        cb && cb();
    });
}

function clearPlayerStates(playerid, cb){
    debug(`Clearing the player status ${playerid}`);
    states.AudioStation.players[playerid].playlist_total = 0;
    states.AudioStation.players[playerid].volume = 0;
    states.AudioStation.players[playerid].album = '';
    states.AudioStation.players[playerid].artist = '';
    states.AudioStation.players[playerid].genre = '';
    states.AudioStation.players[playerid].year = 0;
    states.AudioStation.players[playerid].song_id = 0;
    states.AudioStation.players[playerid].title = '';
    states.AudioStation.players[playerid].path = '';
    states.AudioStation.players[playerid].repeat = '';
    states.AudioStation.players[playerid].shuffle = '';
    states.AudioStation.players[playerid].bitrate = 0;
    states.AudioStation.players[playerid].duration = 0;
    states.AudioStation.players[playerid].current_duration = 0;
    states.AudioStation.players[playerid].current_elapsed = 0;
    states.AudioStation.players[playerid].duration_sec = 0;
    states.AudioStation.players[playerid].seek = 0;
    states.AudioStation.players[playerid].playlist = '';
    states.AudioStation.players[playerid].current_play = 0;
    states.AudioStation.players[playerid].cover = '';
    cb && cb();
}

function getStatusPlayer(cb){
    for (const playerid of Object.keys(states.AudioStation.players)) {
        let param = {};
        if (playerid && states.AudioStation.players[playerid].online){
            debug('* getStatusPlayer ' + playerid);
            param = {
                id: playerid, additional: 'song_tag, song_audio, subplayer_volume'
            };
            send('as', 'getStatusRemotePlayerStatus', param, (res) => {
                if (res && res.state){
                    let state = res.state;
                    if (state === 'playing'){
                        state = 'play';
                    } else if (state === 'stopped' || state === 'none' || state === 'no-media' || state === 'transition'){
                        state = 'stop';
                    }
                    states.AudioStation.players[playerid].state_playing = state;
                    states.AudioStation.players[playerid].online = true;
                    if ((res.state === 'playing' || res.state === 'pause') && res.song){
                        parseRemotePlayerStatus(playerid, res);
                        getPlaylist(playerid, () => {
                            getSongCover(playerid);
                        });
                    } else {
                        if (states.AudioStation.players[playerid].playlist_total !== 0){
                            clearPlayerStates(playerid);
                        }
                    }
                } else {
                    states.AudioStation.players[playerid].online = false;
                    states.AudioStation.players[playerid].state_playing = 'stop';
                    clearPlayerStates(playerid);
                }
            });
        }
    }
}

function getSongCover(playerid, cb){
    debug('getSongCover');
    const track = states.AudioStation.players[playerid].song_id;
    if (track !== old_states.AudioStation.players[playerid].song_id){
        old_states.AudioStation.players[playerid].song_id = track;
        send('as', 'getSongCover', {id: track}, (res) => {
            if (res && !res.message){
                let buf = Buffer.from(res, 'binary');
                adapter.writeFile(adapter.namespace, 'cover.jpg', buf);
                states.AudioStation.players[playerid].cover = '../' + adapter.namespace + '/cover.jpg';
            } else {
                states.AudioStation.players[playerid].cover = '../' + adapter.namespace + '/cover.png';
            }
            cb && cb();
        });
    }
}

function getPlaylist(playerid, cb){
    debug('getPlaylist');
    send('as', 'getPlayListRemotePlayer', {id: playerid}, (res) => {
        if (res){
            parsePlayListRemotePlayer(playerid, res);
            cb && cb();
        }
    });
}

function Browser(playerid, val){
    debug('Browser');
    let param = {};
    if (val && val !== '/'){
        if (~val.toString().indexOf('dir_')){
            param = {id: val};
        } else {
            try {
                const obj = JSON.parse(states.AudioStation.players[playerid].Browser);
                for (let dir_id in obj.files) {
                    if (!obj.files.hasOwnProperty(dir_id)) continue;
                    if (obj.files[dir_id].file === val){
                        param = {id: obj.files[dir_id].id};
                    }
                }
            } catch (e) {
                param = {};
                states.AudioStation.players[playerid].Browser = ''
            }
        }
    }
    send('as', 'listFolders', param, (res) => {
        let arr = {files: []};
        res.items.forEach((k, i) => {
            let filetype = 'file';
            if (res.items[i].type === 'folder'){
                filetype = 'directory';
            }
            arr.files.push({
                "id":       res.items[i].id,
                "file":     res.items[i].path,
                "filetype": filetype,
                "title":    res.items[i].title
            });
        });
        states.AudioStation.players[playerid].Browser = JSON.stringify(arr);
        old_states.AudioStation.players[playerid].Browser = '';
    });
}

function PlayControl(playerid, cmd, val){
    debug('PlayControl');
    let param = {
        id:     playerid,
        action: cmd,
        value:  null
    };
    if (playerid){
        if (cmd === 'volume'){
            param.action = 'set_volume';
            param.value = val;
        }
        if (cmd === 'seek'){
            param.value = parseFloat((val / 100) * states.AudioStation.players[playerid].duration_sec).toFixed(4);
        }
        if (cmd === 'repeat'){
            param.action = 'set_repeat';
            param.value = val;
        }
        if (cmd === 'shuffle'){
            param.action = 'set_shuffle';
            param.value = val;
        }
        send('as', 'controlRemotePlayer', param);
    }
}

function PlayFolder(playerid, folder){
    debug('PlayFolder');
    let param = {};
    if (playerid){
        send('as', 'controlRemotePlayer', {id: playerid, action: 'stop'}, () => {
            clearPlaylist(playerid, () => {
                param = {
                    id:                 playerid,
                    library:            'shared',
                    keep_shuffle_order: false,
                    offset:             0,
                    limit:              0,
                    play:               true,
                    containers_json:    JSON.stringify([{"type": "folder", "id": folder, "recursive": true, "sort_by": "title", "sort_direction": "ASC"}])
                };
                send('as', 'updatePlayListRemotePlayer', param, () => { //add folder to playlist
                    send('as', 'controlRemotePlayer', {id: playerid, action: 'play'});
                });
            });
        });
    }
}

function PlayTrack(playerid, val){
    debug('PlayTrack');
    let param = {};
    if (playerid){
        param = {
            id:                 playerid,
            library:            'shared',
            offset:             0,
            limit:              0,
            play:               true,
            songs:              val,
            keep_shuffle_order: false
            //containers_json: JSON.stringify([])
        };
        send('as', 'updatePlayListRemotePlayer', param, () => { // updatesongsPlaylist
            send('as', 'controlRemotePlayer', {id: playerid, action: 'play', value: 0});
        });
    }
}

function PlayTrackNum(playerid, val){
    debug('PlayTrackNum');
    if (playerid){
        send('as', 'controlRemotePlayer', {id: playerid, action: 'play', value: val});
    }
}

function PlayTrackId(playerid, val){
    debug('PlayTrack');
    try {
        let arr = JSON.parse(states.AudioStation.players[playerid].playlist);
        let track = arr.findIndex(item => item.id === val);
        if (track){
            send('as', 'controlRemotePlayer', {id: playerid, action: 'play', value: track});
        } else {
            error('PlayTrackId:', 'Error track not found');
        }
    } catch (e) {
        error('PlayTrackId:', 'Error parse playlist');
    }
}

function parseListRemotePlayers(res){
    debug('ListRemotePlayers - Response: ' + JSON.stringify(res));
    //states.AudioStation.info.RemotePlayers = JSON.stringify(res.players);
    res.players.forEach((player) => {
        const playerid = player.id;
        if (states.AudioStation.players[playerid] === undefined){
            states.AudioStation.players[playerid] = {};
            states.AudioStation.players[playerid].online = true;
            states.AudioStation.players[playerid].player_name = player.name;
            states.AudioStation.players[playerid].stop = '';
            states.AudioStation.players[playerid].pause = '';
            states.AudioStation.players[playerid].play = '';
            states.AudioStation.players[playerid].prev = '';
            states.AudioStation.players[playerid].next = '';
            states.AudioStation.players[playerid].play_folder = '';
            states.AudioStation.players[playerid].play_track = '';
            states.AudioStation.players[playerid].Browser = '';
            states.AudioStation.players[playerid].clearPlaylist = false;
        }
    });
}

function parseRemotePlayerStatus(playerid, res){
    debug('RemotePlayerStatus - Response: ' + JSON.stringify(res));
    try {
        if (res && res.index !== undefined){
            let seek = parseFloat((res.position / res.song.additional.song_audio.duration) * 100).toFixed(4);
            states.AudioStation.players[playerid].current_play = res.index;
            states.AudioStation.players[playerid].playlist_total = res.playlist_total;
            states.AudioStation.players[playerid].volume = res.volume;
            states.AudioStation.players[playerid].subplayer_volume = res.subplayer_volume;
            states.AudioStation.players[playerid].album = res.song.additional.song_tag.album;
            states.AudioStation.players[playerid].artist = res.song.additional.song_tag.artist;
            states.AudioStation.players[playerid].genre = res.song.additional.song_tag.genre;
            states.AudioStation.players[playerid].year = res.song.additional.song_tag.year;
            states.AudioStation.players[playerid].song_id = res.song.id;
            states.AudioStation.players[playerid].title = res.song.title;
            states.AudioStation.players[playerid].path = res.song.path;
            states.AudioStation.players[playerid].repeat = res.play_mode.repeat;
            states.AudioStation.players[playerid].shuffle = res.play_mode.shuffle;
            states.AudioStation.players[playerid].bitrate = res.song.additional.song_audio.bitrate / 1000;
            states.AudioStation.players[playerid].duration = SecToText(res.song.additional.song_audio.duration);
            states.AudioStation.players[playerid].duration_sec = res.song.additional.song_audio.duration;
            states.AudioStation.players[playerid].current_duration = SecToText(res.position);
            states.AudioStation.players[playerid].current_elapsed = res.song.additional.song_audio.duration > 0 ? SecToText(res.song.additional.song_audio.duration - res.position) :0;
            states.AudioStation.players[playerid].seek = isFinite(seek) ? seek :0;
        }
    } catch (e) {
        debug('RemotePlayerStatus - Error: ' + JSON.stringify(e));
    }
}

function parsePlayListRemotePlayer(playerid, res){
    debug('PlayListRemotePlayer - Response: ' + JSON.stringify(res));
    try {
        let playlist = [];
        if (res && res.songs){
            let arr = res.songs;
            arr.forEach((k, i) => {
                playlist[i] = {
                    "id":      arr[i].id,
                    "artist":  "",
                    "album":   "",
                    "bitrate": 0,
                    "title":   arr[i].title,
                    "file":    arr[i].path,
                    "genre":   "",
                    "year":    0,
                    "len":     "00:00",
                    "rating":  "",
                    "cover":   ""
                }
            });
        }
        states.AudioStation.players[playerid].playlist = JSON.stringify(playlist);
    } catch (e) {

    }
}

function parselistRadios(res){
    debug('listRadios - Response: ' + JSON.stringify(res));
    if (res && !res.message){
        try {
            let radio_playlist = [];
            if (res.radios){
                let arr = res.radios;
                arr.forEach((k, i) => {
                    radio_playlist[i] = {
                        "id":      arr[i].id,
                        "artist":  "",
                        "album":   "",
                        "bitrate": arr[i].desc ? arr[i].desc.match(/\(.*?(\d+)/)[1] :"",
                        "title":   arr[i].title,
                        "file":    arr[i].url,
                        "genre":   "",
                        "year":    0,
                        "len":     "00:00",
                        "rating":  "",
                        "cover":   ""
                    }
                });
                Object.keys(states.AudioStation.players).forEach((playerid) => {
                    states.AudioStation.players[playerid].favoriteRadio = JSON.stringify(radio_playlist);
                });
            }
        } catch (e) {
            debug('listRadios - Error: ' + JSON.stringify(res));
        }
    }
}

/*********************** FileStation ************************/

function CreateSharing(command, link){
    debug('CreateSharings');
    let params_set = {};
    if (link){
        try {
            params_set = JSON.parse(link);
        } catch (e) {
            error('CreateSharings', 'Error JSON parse command ' + link);
        }
        if (!('path' in params_set)){
            params_set.path = link;
        }
        if (!('password' in params_set)){
            params_set.password = '';
        }
        send('fs', 'createSharing', params_set, (res) => {
            if (res){
                CreateSharings(res);
            }
        });
    } else {
        error('CreateSharings', 'Link not set');
    }
}

function DeleteSharing(command, id){
    debug('DeleteSharings');
    if (id){
        send('fs', 'deleteSharing', {'id': id});
    } else {
        error('DeleteSharings', 'ID not set');
    }
}

function parseListSharings(res){
    debug('parseListSharings - Response: ' + JSON.stringify(res));
    let arr = res.links;
    let temp_array = [];
    arr.forEach((k, i) => {
        if (arr[i].id){
            temp_array[i] = {
                'name':           arr[i].name,
                'date_available': arr[i].date_available,
                'date_expired':   arr[i].date_expired,
                'expire_times':   arr[i].expire_times,
                'enable_upload':  arr[i].enable_upload,
                'has_password':   arr[i].has_password,
                'id':             arr[i].id,
                'isFolder':       arr[i].isFolder,
                'link_owner':     arr[i].link_owner,
                'limit_size':     arr[i].limit_size,
                'path':           arr[i].path,
                'qrcode':         arr[i].qrcode,
                'status':         arr[i].status,
                'url':            arr[i].url,
                'request_info':   arr[i].request_info,
                'request_name':   arr[i].request_name
            }
        }
    });
    states.FileStation.sharing['list'] = JSON.stringify(temp_array);
}

function CreateSharings(res){
    debug('parseCreateSharings - Response: ' + JSON.stringify(res));
    let arr = res.links;
    states.FileStation.sharing['last_url'] = JSON.stringify(arr[0].url);
    states.FileStation.sharing['last_qrcode'] = JSON.stringify(arr[0].qrcode);
}

/************************** DSM ****************************/

function parseInfoSystem(res){
    debug('InfoSystem - Response: ' + JSON.stringify(res));
    if (res && res.hdd_info){
        res.hdd_info.forEach((key) => {
            const diskname = key.diskno.toLowerCase().replace(' ', '_');
            states.DiskStationManager.hdd_info[diskname] = {
                'diskno':          key.diskno,
                'model':           key.model.replace(/\s{2,}/g, ''),
                'overview_status': key.status,
                'ebox_order':      key.ebox_order,
                'temperature':     key.temp,
                'storage_pool':    key.volume,
                'capacity':        (key.capacity / 1073741824).toFixed(2, 10)
            };
        });
        if(res.vol_info){
        res.vol_info.forEach((key) => {
            const volname = key.name.toLowerCase();
            states.DiskStationManager.vol_info[volname] = {
                'name':       key.name,
                'status':     key.status,
                'total_size': (key.total_size / 1073741824).toFixed(2, 10),
                'used_size':  (key.used_size / 1073741824).toFixed(2, 10),
                'used':       ((key.used_size / key.total_size) * 100).toFixed(2, 10),
                'desc':       key.desc
            };
        });
    }
    }
}

function parseInstallingPackets(res){
    debug('InstallingPackets - Response: ' + JSON.stringify(res));
    if (res && res.packages){
        if (!Array.isArray(res.packages)){
            for (let fullname in res.packages) { // for getPollingData
                if (!res.packages.hasOwnProperty(fullname)) continue;
                for (let name in states.api) {
                    if (!states.api.hasOwnProperty(name)) continue;
                    if (states.api[name].name === fullname){
                        states.api[name]['installed'] = res.packages[fullname];
                    }
                }
            }
        } else {
            let arr = res.packages; // for listPackages
            arr.forEach((obj) => {
                for (let name in states.api) {
                    if (!states.api.hasOwnProperty(name)) continue;
                    if (states.api[name].name === obj.id){
                        states.api[name]['installed'] = true;
                    }
                }
            });
        }
    }
}

function parseInfo(res, api){
    debug('Info - Response: ' + JSON.stringify(res));
    if (states.api[api].installed){
        const apiName = states.api[api].name;
        if (apiName !== 'SurveillanceStation'){
            Object.keys(res).forEach((key) => {
                states[apiName].info[key] = res[key];
            });
        } else {
            parseSSInfo(res);
        }
    }
}

function parseTempInfo(res){
    debug('TempInfo - Response: ' + JSON.stringify(res));
    states.DiskStationManager.info.temperature = res.temperature;
    states.DiskStationManager.info.temperature_warn = res.temperature_warn;
    states.DiskStationManager.info.time = res.time;
}

function parseSystemUtilization(res){
    debug('SystemUtilization - Response: ' + JSON.stringify(res));
    if (res && res.cpu){
        states.DiskStationManager.info['cpu_load'] = parseInt(res.cpu.user_load);
        states.DiskStationManager.info['memory_usage'] = parseInt(res.memory.real_usage);
        states.DiskStationManager.info['memory_size'] = parseInt(res.memory.memory_size);
    }
}

function parseSystemStatus(res){
    debug('SystemStatus - Response: ' + JSON.stringify(res));
    states.DiskStationManager.info['is_disk_wcache_crashed'] = res.is_disk_wcache_crashed;
    states.DiskStationManager.info['is_system_crashed'] = res.is_system_crashed;
    states.DiskStationManager.info['upgrade_ready'] = res.upgrade_ready;
}

/** **************************************************************/

function parseTest(res){
    debug('test - Response: ' + JSON.stringify(res));

    //{api: 'ss', method: 'listEvents', params: {locked: 0, reason: 2, limit: 1, /*cameraIds: '2', */version: 4}, ParseFunction: parse.listEvents}, // Рабочий вариант
    //{api: 'fs', method: 'listSharings', params: {offset: 0}, ParseFunction: parse.test},
    //{api: 'ss', method: 'getInfoCamera', params: {optimize: true, streamInfo: true, ptz: true, deviceOutCap: true, fisheye: true, basic: true, cameraIds: '2', eventDetection: true, privCamType: 1, camAppInfo: true, version: 8}, ParseFunction: parse.test},
    //{api: 'ss', method: 'OneTimeCameraStatus', params: {id_list: "2"}, ParseFunction: parse.test},

    //{api: 'ss', method: 'getInfoCamera', params: {basic: true, cameraIds: '2', eventDetection: true, privCamType: 3, camAppInfo: true, version: 8}, ParseFunction: parse.dIStsPollIngCameraEvent},
    //{api: 'ss', method: 'motionEnumCameraEvent', params: {camId: 2}, ParseFunction: parse.dIStsPollIngCameraEvent},
    //{api: 'ss', method: 'enumAlert', params: {camIdList: '2', typeList: '0,1,2,3,4,5,6,7', lock: '0' }, ParseFunction: parse.dIStsPollIngCameraEvent},
    //{api: 'ss', method: 'listLogs', params: {cameraIds: "2"}, ParseFunction: parse.dIStsPollIngCameraEvent}, //События
}

/** **************************************************************/

function sendMethod(name, val){
    debug('sendMethod to ' + name + ' cmd:' + val);
    const api = isInstalled(name);
    if (api){
        let json, param;
        try {
            json = JSON.parse(val);
            if (!json.method){
                error('sendMethod', 'Error command - ' + val + ' Method not specified');
            } else {
                const method = json.method;
                if (typeof json.params === 'object'){
                    param = json.params;
                } else {
                    param = {};
                }
                send(api, method, param, (res) => {
                    if (res){
                        const id = name + '.sendMethod';
                        adapter.setState(id, {val: JSON.stringify(res), ack: true});
                    }
                });
            }
        } catch (err) {
            error('sendMethod', 'Error JSON parse command ' + JSON.stringify(err));
        }
    } else {
        error('sendMethod', name + ' Not installed!');
    }
}

function queuePolling(){
    iteration = 0;
    let namePolling = '';
    if (endTime - startTime > slowPollingTime){
        startTime = new Date().getTime();
        namePolling = 'slowPoll';
    } else {
        namePolling = 'fastPoll';
    }
    if (firstStart) namePolling = 'firstPoll';
    sendPolling(namePolling);
}

function sendPolling(namePolling){
    const poll = PollCmd[namePolling][iteration];
    debug('-----------------------------------------------------------------------------------------------------');
    if (poll !== undefined){
        debug('* sendPolling. namePolling = ' + namePolling + ' | iteration = ' + iteration + ' | typeof poll = ' + typeof poll + ' | poll = ' + JSON.stringify(poll));
        if (typeof poll === 'function'){
            poll();
            iterator(namePolling);
        } else if (states.api[poll.api].installed){
            const api = poll.api;
            const method = poll.method;
            const params = poll.params;
            debug(`* Get info from (${namePolling}) api: ${api.toUpperCase()} method: ${method} params: ${JSON.stringify(params)}`);
            try {
                syno[api][method](params, (err, res) => {
                    debug(!err && res ? '* The response is received, parse:' :'* No response, read next.');
                    if (!err && res){
                        if (!connect) setInfoConnection(true);
                        connect = true;
                        if (typeof poll.ParseFunction === "function"){
                            poll.ParseFunction(res, api);
                        } else {
                            error('ParseFunction', 'syno[' + api + '][' + method + '] Error - Not Function!');
                        }
                    } else if (err){
                        if (api === 'ss' && method === 'getInfo' && ~err.toString().indexOf('version does not support')){
                            adapter.log.warn('sendPolling Error -' + err + ' You are using a hacked version of SS?');
                        } else if (~err.toString().indexOf('No such account or incorrect password')){
                            error('sendPolling syno[' + api + '][' + method + '] To use the adapter, the user must be in the Administrators group!', err);
                        } else {
                            error('*sendPolling syno[' + api + '][' + method + ']', err);
                        }
                        if (method === 'getPollingData' || method === 'listPackages'){
                            iteration = -1;
                        }
                    }
                    if (adapter.config['2fa_checkbox'] && firstStart){
                        timeOut && clearTimeout(timeOut);
                        timeOut = setTimeout(() => {
                            iterator(namePolling);
                        }, 30000);
                    } else {
                        iterator(namePolling);
                    }
                });
            } catch (e) {
                error('sendPolling catch - syno[' + api + '][' + method + ']', e);
            }
        } else {
            debug(`* Packet ${poll.api.toUpperCase()} non installed, skipped`);
            iterator(namePolling);
        }
    } else {
        debug('* Poll undefined > ' + JSON.stringify(poll));
        iterator(namePolling);
    }
}

function iterator(namePolling){
    iteration++;
    if (iteration > PollCmd[namePolling].length - 1){
        iteration = 0;
        timeOutPoll && clearTimeout(timeOutPoll);
        if (namePolling === 'firstPoll') firstStart = false;
        debug('-----------------------------------------------------------------------------------------------------');
        debug('>>>>>>>>>>>>>>> Read all data, save received data.');
        setStates();
        timeOutPoll = setTimeout(() => {
            endTime = new Date().getTime();
            queuePolling();
        }, pollTime);
    } else {
        sendPolling(namePolling);
    }
}

function send(api, method, params, cb){
    if (typeof params === 'function'){
        cb = params;
        params = null;
    }
    try {
        syno[api][method](params, (err, data) => {
            debug('Send [' + api.toUpperCase() + '] [' + method + '] Error: [' + (err || 'no error') + '] Response: [' + typeof data + ']');
            data = data || '';
            if (!err){
                cb && cb(data);
            } else if (err){
                if (method === 'getStatusRemotePlayerStatus'){
                    cb && cb(false);
                } else {
                    error('function send: [' + api + '][' + method + ']', err, () => {
                        cb && cb(false);
                    });
                }
            }
        });
    } catch (e) {
        error('--- SEND Error ', JSON.stringify(e));
    }
}

function setStates(){
    debug('setStates');
    let ids = '';
    Object.keys(states).forEach((_api) => {
        if (_api !== 'api'){
            Object.keys(states[_api]).forEach((_type) => {
                if (typeof states[_api][_type] == 'object'){
                    Object.keys(states[_api][_type]).forEach((key) => {
                        if (typeof states[_api][_type][key] == 'object'){
                            //states[_api][_type][key] = JSON.stringify(states[_api][_type][key]);
                            Object.keys(states[_api][_type][key]).forEach((key2) => {
                                //adapter.log.error('*********' + states[_api][_type][key][key2]);
                                if (!old_states[_api][_type].hasOwnProperty(key)){
                                    old_states[_api][_type][key] = {};
                                }
                                if (states[_api][_type][key][key2] !== old_states[_api][_type][key][key2]){
                                    old_states[_api][_type][key][key2] = states[_api][_type][key][key2];
                                    ids = _api + '.' + _type + '.' + key + '.' + key2;
                                    setObject(ids, states[_api][_type][key][key2]);
                                }
                            });
                        } else {
                            if (states[_api][_type][key] !== old_states[_api][_type][key]){
                                old_states[_api][_type][key] = states[_api][_type][key];
                                ids = _api + '.' + _type + '.' + key;
                                setObject(ids, states[_api][_type][key]);
                            }
                        }
                    });
                } else {
                    if (states[_api][_type] !== old_states[_api][_type]){
                        old_states[_api][_type] = states[_api][_type];
                        ids = _api + '.' + _type;
                        setObject(ids, states[_api][_type]);
                    }
                }
            });
        }
    });
}

function setObject(id, val){
    debug('setObject ' + JSON.stringify(id));
    adapter.getObject(id, function (err, obj){
        let common = {
            name: id, desc: id, type: 'string', role: 'state'
        };
        let _id = id.split('.');
        _id = _id[_id.length - 1];
        if (objects[_id] !== undefined){
            common.name = objects[_id].name;
            common.desc = objects[_id].name;
            common.role = objects[_id].role;
            common.type = objects[_id].type;
            if (objects[_id].unit !== undefined) common.unit = objects[_id].unit;
            if (objects[_id].min !== undefined) common.min = objects[_id].unit;
            if (objects[_id].max !== undefined) common.max = objects[_id].unit;
            if (objects[_id].states !== undefined) common.states = objects[_id].states;
            common.read = objects[_id].read;
            common.write = objects[_id].write;
            //common.def = objects[_id].val;
        }
        if ((err || !obj)){
            adapter.setObject(id, {
                type: 'state', common: common, native: {}
            });
            adapter.setState(id, {val: val, ack: true});
        } else {
            if (JSON.stringify(obj.common) !== JSON.stringify(common) && objects[_id] !== undefined){
                adapter.extendObject(id, {common: common});
            }
            if (_id === 'player_name'){
                const ids = id.split('.').slice(0, -1).join('.');
                adapter.extendObject(ids, {
                    type:   'channel',
                    common: {name: val, type: 'state'},
                    native: {id: val}
                });
            }
            adapter.setState(id, {val: val, ack: true});
        }
    });
}

function error(src, e, cb){
    let code = e.code;
    let message;
    if (e.message === undefined){
        message = e;
    } else {
        message = e.message;
    }
    if(!~src.indexOf('getSongCover')){
        adapter.log.error('*** ERROR : src: ' + (src || 'unknown') + ' code: ' + code + ' message: ' + message);
    }
    if (code === 400 || /*code === 500 || */code === 'ECONNREFUSED' || code === 'ETIMEDOUT'){
        timeOutRecconect && clearTimeout(timeOutRecconect);
        timeOutPoll && clearTimeout(timeOutPoll);
        setInfoConnection(false);
        connect = false;
        timeOutRecconect = setTimeout(() => {
            newSyno();
        }, 10000);
    } else {
        cb && cb(e);
    }
}

function main(){
    if (!adapter.systemConfig) return;
    adapter.subscribeStates('*');
    setInfoConnection(false);
    old_states = JSON.parse(JSON.stringify(states));
    pollTime = adapter.config.polling || 100;
    slowPollingTime = adapter.config.slowPollingTime || 60000;
    if (pollTime > slowPollingTime){
        adapter.log.warn('pollTime > slowPollingTime! It is necessary to fix the polling time in the settings');
    }
    if (parseInt(adapter.config.version, 10) < 6){
        PollCmd.firstPoll[0] = {api: 'dsm', method: 'listPackages', params: {version: 1}, ParseFunction: parseInstallingPackets};
    }
    if (!adapter.config.ss || !adapter.config.dl || !adapter.config.as){
        let result;
        result = PollCmd.fastPoll.filter(item => {
            return !((item.api === 'ss' && !adapter.config.ss) || (item.api === 'dl' && !adapter.config.dl) || ((item.api === 'as' || (typeof item === 'function' && item.name === 'getStatusPlayer')) && !adapter.config.as));
        });
        PollCmd.fastPoll = result;

        result = PollCmd.slowPoll.filter(item => {
            return !((item.api === 'ss' || (typeof item === 'function' && (item.name === 'addLinkSnapShot' || item.name === 'getLiveViewPathCamera')) && !adapter.config.ss) || (item.api === 'dl' && !adapter.config.dl) || (item.api === 'as' && !adapter.config.as));
        });
        PollCmd.slowPoll = result;
    }
    pathInstance = adapter.namespace.replace('.', '_') + '/';
    dir = utils.controllerDir + '/' + adapter.systemConfig.dataDir + adapter.namespace.replace('.', '_') + '/';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    adapter.writeFile(adapter.namespace, 'cover.png', fs.readFileSync(__dirname + '/admin/cover.png'));
    newSyno();
}

function newSyno(){
    startTime = new Date().getTime();
    endTime = new Date().getTime();
    try {
        syno = new Syno({
            ignoreCertificateErrors: true, /*rejectUnauthorized: false,*/
            host:                    adapter.config.host || '127.0.0.1',
            port:                    adapter.config.port || '5000',
            account:                 adapter.config.login || 'admin',
            passwd:                  adapter.config.password || '',
            protocol:                adapter.config.https ? 'https' :'http',
            apiVersion:              adapter.config.version || '6.2.2',
            otp:                     adapter.config['2fa_checkbox'] ? (adapter.config['2fa_code'] || 'ASE32YJSBKUOIDPB') :false,
            debug:                   false
        });
        queuePolling();
    } catch (e) {
        error('new Syno Error: ', e.message);
    }
}

function setInfoConnection(val){
    adapter.getState('info.connection', function (err, state){
        if (!err && state !== null){
            if (state.val === val){
            } else if (state.val !== val){
                adapter.setState('info.connection', val, true);
            }
        } else if (!state && !err){
            adapter.setState('info.connection', val, true);
        }
    });
}

function rePollAfterCmd(){
    timeOutPoll && clearTimeout(timeOutPoll);
    setInfoConnection(false);
    connect = false;
    endTime = new Date().getTime();
    queuePolling();
}

function isInstalled(fullname){
    for (let api in states.api) {
        if (!states.api.hasOwnProperty(api)) continue;
        if (states.api[api].name === fullname){
            return api;
        }
    }
    return false;
}

function debug(msg){
    adapter.log.debug(msg);
}

const unixToDate = (timestamp) => {
    return moment.unix(timestamp).format("DD/MM/YYYY, HH:mm");
};
const dateToUnix = (date) => {
    let ts = moment(date).unix();
    return moment.unix(ts);
};

function SecToText(sec){
    let res;
    let m = Math.floor(sec / 60);
    let s = sec % 60;
    let h = Math.floor(m / 60);
    m = m % 60;
    if (h > 0){
        res = pad2(h) + ":" + pad2(m) + ":" + pad2(s);
    } else {
        res = pad2(m) + ":" + pad2(s);
    }
    return res;
}

function pad2(num){
    let s = num.toString();
    return (s.length < 2) ? "0" + s :s;
}

if (module.parent){
    module.exports = startAdapter;
} else {
    startAdapter();
}
