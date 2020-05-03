"use strict";
const utils = require('@iobroker/adapter-core');
let Syno = require('syno');
const fs = require('fs');
const http = require('http');
const parse = require('./lib/parsers.js');
let adapter, syno, timeOutPoll, timeOutRecconect, pollTime, connect = false, iteration = 0, isPoll = false, queueCmd = null, startTime, endTime, pollAllowed = true,
    firstStart = true, slowPollingTime, dir, old_states;

function startAdapter(options){
    return adapter = utils.adapter(Object.assign({}, options, {
        systemConfig: true,
        name:         'synology',
        ready:        main,
        unload:       callback => {
            timeOutPoll && clearTimeout(timeOutPoll);
            timeOutRecconect && clearTimeout(timeOutRecconect);
            try {
                adapter.log.debug('cleaned everything up...');
                callback();
            } catch (e) {
                callback();
            }
        },
        stateChange:  (id, state) => {
            if (id && state && !state.ack){
                adapter.log.debug(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
                let ids = id.split(".");
                let name = ids[ids.length - 2].toString();
                let command = ids[ids.length - 1].toString();
                let val = state.val;
                if (command === 'reboot'){
                    send('dsm', 'rebootSystem', (res) => {
                        adapter.log.debug('System reboot');
                        rePollAfterCmd();
                    });
                    return;
                }
                if (command === 'shutdown'){
                    send('dsm', 'shutdownSystem', (res) => {
                        adapter.log.debug('System shutdown');
                        rePollAfterCmd();
                    });
                    return;
                }
                if (command === 'Browser'){  /*  /AS  */
                    if (name in states.AudioStation.players){
                        queueCmd = true;
                        Browser(states, name, val);
                    } else {
                        adapter.log.error('Error player ' + name + ' offline?');
                    }
                } else if (command === 'play_folder'){
                    PlayFolder(states, name, val);
                } else if (command === 'play_track'){
                    PlayTrack(states, name, val);
                } else if (command === 'song_id'){
                    PlayTrackId(states, name, val);
                } else if (command === 'current_play'){
                    PlayTrackNum(states, name, val);
                } else if (command === 'clearPlaylist'){
                    clearPlaylist(states, name);
                } else if (command === 'stop' || command === 'next' || command === 'prev' || command === 'volume' || command === 'seek' || command === 'pause' || command === 'play' || command === 'repeat' || command === 'shuffle'){
                    PlayControl(states, name, command, val);
                } else if (command === 'getSnapshotCamera'){
                    getSnapshotCamera(val);
                } else if (command === 'add_url_download' || command === 'add_hash_download'){
                    addDownload(command, val);
                } else if (command === 'shedule_emule_enabled' || command === 'shedule_enabled'){
                    setConfigSchedule(command, val);
                } else if (command === 'pause_task' || command === 'resume_task'){
                    pauseTask(command, val);
                } else if (command === 'enabled'){
                    switchCam(states, name, command, val);
                } else if (command === 'status_on'){
                    send('ss', 'switchHomeMode', {on: val});
                } else {
                    if (states.api[name]){
                        if (states.api[name].installed){
                            let json, param;
                            try {
                                json = JSON.parse(val);
                                if (!json.method){
                                    adapter.log.error('Error command');
                                } else {
                                    val = json.method;
                                    if (typeof json.params === 'object'){
                                        param = json.params;
                                    } else {
                                        param = {};
                                    }
                                    send(api[name]['name'], val, param, (res) => {
                                        if (res){
                                            let id = name + '.sendMethod';
                                            adapter.setState(id, {
                                                val: JSON.stringify(res), ack: true
                                            });
                                        }
                                    });
                                }
                            } catch (err) {
                                adapter.log.error('Error JSON parse command ' + JSON.stringify(err));
                            }
                        } else {
                            adapter.log.error(name + ' Not installed!');
                        }
                    }
                }
            }
        },
        message:      obj => {
            if (typeof obj === 'object' && obj.command){
                adapter.log.debug(`message ******* ${JSON.stringify(obj)}`);
                if (obj.command === 'getSnapshot' && obj.message.camId){
                    getSnapshotCamera(parseInt(obj.message.camId, 10), (res) => {
                        obj.callback && adapter.sendTo(obj.from, obj.command, res, obj.callback);
                    });
                }
            } else {
                adapter.log.debug(`message x ${obj.command}`);
            }
        }
    }));
}

let states = {
    DiskStationManager:  {info: {}, hdd_info: {}, vol_info: {}},
    FileStation:         {info: {}},
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
};

let PollCmd = {
    "firstPoll": [
        {api: 'dsm', method: 'getPollingData', params: {}, ParseFunction: parse.InstallingPackets},
        {api: 'dsm', method: 'getInfo', params: {}, ParseFunction: parse.Info},
        {api: 'fs', method: 'getInfo', params: {}, ParseFunction: parse.Info},
        {api: 'dl', method: 'getInfo', params: {}, ParseFunction: parse.Info},
        {api: 'as', method: 'getInfo', params: {}, ParseFunction: parse.Info},
        {api: 'vs', method: 'getInfo', params: {}, ParseFunction: parse.Info},
        {api: 'dtv', method: 'GetInfoTuner', params: {}, ParseFunction: parse.Info},
        {api: 'ss', method: 'getInfo', params: {}, ParseFunction: parse.Info},
        {api: 'ss', method: 'getInfoHomeMode', params: {need_mobiles: true}, ParseFunction: parse.InfoHomeMode},
        {api: 'ss', method: 'listCameras', params: {basic: true, version: 7}, ParseFunction: parse.listCameras},
        {api: 'as', method: 'listRemotePlayers', params: {}, ParseFunction: parse.ListRemotePlayers},
    ],
    "fastPoll":  [
        {api: 'dsm', method: 'getSystemUtilization', params: {}, ParseFunction: parse.SystemUtilization},
        {api: 'dsm', method: 'getSystemStatus', params: {}, ParseFunction: parse.SystemStatus},
        {api: 'dsm', method: 'getInfo', params: {}, ParseFunction: parse.TempInfo},
        {api: 'dsm', method: 'infoSystem', params: {type: "storage", version: 1}, ParseFunction: parse.InfoSystem},
        getStatusRemotePlayers,
        {api: 'ss', method: 'getInfoHomeMode', params: {need_mobiles: true}, ParseFunction: parse.InfoHomeMode},
        {api: 'dl', method: 'getConfigSchedule', params: {}, ParseFunction: parse.getConfigSchedule},
        //{api: 'ss', method: 'listEvents', params: {locked: 0, reason: 2, limit: 1, cameraIds: '2', version: 4}, ParseFunction: parse.test},
        //{api: 'ss', method: 'getInfoCamera', params: {optimize: true, streamInfo: true, ptz: true, deviceOutCap: true, fisheye: true, basic: true, cameraIds: '2', eventDetection: true, privCamType: 1, camAppInfo: true, version: 8}, ParseFunction: parse.test},
        //{api: 'ss', method: 'OneTimeCameraStatus', params: {id_list: "2"}, ParseFunction: parse.test},
    ],
    "slowPoll":  [
        {api: 'as', method: 'listRemotePlayers', params: {}, ParseFunction: parse.ListRemotePlayers},
        {api: 'ss', method: 'listCameras', params: {basic: true, version: 7}, ParseFunction: parse.listCameras},
        {api: 'dl', method: 'listTasks', params: {}, ParseFunction: parse.listTasks},
        {api: 'as', method: 'listRadios', params: {container: 'Favorite', limit: 1000, library: 'shared', sort_direction: 'ASC'}, ParseFunction: parse.listRadios},
        addLinkSnapShot,
        getLiveViewPathCamera
    ]
};

//////////////////////////* SurveillanceStation */////////////////////
const getArrIdCams = () => {
    let ids = [];
    Object.keys(states.SurveillanceStation.cameras).forEach((nameCam) => {
        if (nameCam !== undefined) ids.push(states.SurveillanceStation.cameras[nameCam].id);
    });
    return ids;
};

function switchCam(states, name, command, val){
    let method = !!val ? 'enableCamera' :'disableCamera';
    if (name !== 'undefined'){
        let camId = states.SurveillanceStation.cameras[name].id.toString();
        send('ss', method, {cameraIds: camId, blIncludeDeletedCam: false});
    }
}

function addLinkSnapShot(states){
    adapter.log.debug('--------------------- addLinkSnapShot -----------------------');
    Object.keys(states.SurveillanceStation.cameras).forEach((nameCam) => {
        if (nameCam !== undefined){
            const camId = states.SurveillanceStation.cameras[nameCam].id;
            const _sid = syno.sessions.SurveillanceStation ? syno.sessions.SurveillanceStation._sid :'';
            states.SurveillanceStation.cameras[nameCam]['linkSnapshot'] = syno.protocol + '://' + syno.host + ':' + syno.port + '/webapi/entry.cgi?api=SYNO.SurveillanceStation.Camera&method=GetSnapshot&version=7&cameraId= ' + camId + '&_sid=' + _sid;
        }
    });
    return states;
}

function getLiveViewPathCamera(states){
    adapter.log.debug('--------------------- getLiveViewPathCamera -----------------------');
    const ids = getArrIdCams().join(',');
    if (ids){
        send('ss', 'getLiveViewPathCamera', {idList: ids}, (res) => {
            if (res && !res.code && !res.message){
                states = parse.LiveViewPathCamera(states, res);
            }
        });
    }
    return states;
}

function getSnapshotCamera(camid, cb){
    adapter.log.debug('--------------------- getSnapshotCamera -----------------------');
    const param = {cameraId: camid, preview: true, version: 7};
    send('ss', 'getSnapshotCamera', param, (res) => {
        if (res && !res.code && !res.message){
            let buf = Buffer.from(res, 'binary');
            fs.writeFile(dir + 'snapshotCam_' + camid + '.jpg', buf, (err) => {
                if (!err){
                    cb && cb(dir + 'snapshotCam_' + camid + '.jpg');
                } else {
                    cb && cb(false);
                    adapter.log.error('Write snapshot file Error: ' + err);
                }
            });
        }
    });
}

/////////////////////////* DownloadStation */////////////////////////
function addDownload(command, url, cb){
    adapter.log.debug('--------------------- addDownload -----------------------');
    if (command === 'add_hash_download'){
        url = 'magnet:?xt=urn:btih:' + url;
    }
    let param = {
        type: "url", create_list: true, uri: [url], version: 2
    };
    adapter.getState('DownloadStation.folder', (err, state) => {
        if (!err || state){
            param.destination = state.val;
        }
        send('dl', 'createTask', param, (res) => {
            if (res && res.message){
                adapter.log.error('addDownload Error: ' + res.message);
            }
            cb && cb();
        });
    });
}

function setConfigSchedule(command, val){
    adapter.log.debug('--------------------- setConfigSchedule -----------------------');
    let param;
    if (command === 'shedule_enabled'){
        param = {enabled: val};
    }
    if (command === 'shedule_emule_enabled'){
        param = {emule_enabled: val};
    }
    send('dl', 'setConfigSchedule', param, (res) => {
        if (res && res.message){
            adapter.log.error('setConfigSchedule Error: ' + res.message);
        }
    });
}

function pauseTask(command, val){
    adapter.log.debug('--------------------- pauseTask -----------------------');
    let param, method, ids = [];
    if (!~val.indexOf('dbid_') && val !== 'all'){
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

////////////////////////* AudioStation *////////////////////////////

function clearPlaylist(states, playerid, cb){
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

function getStatusRemotePlayers(states){
    //adapter.log.debug('--------------------- getStatusRemotePlayers -----------------------');
    Object.keys(states.AudioStation.players).forEach((playerid) => {
        getStatusPlayer(playerid);
    });
    return states;
}

function clearPlayerStates(playerid){
    adapter.log.debug('-------- clearPlayerStates ----------');
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
}

function getStatusPlayer(playerid, cb){
    //adapter.log.debug('--------------------- getStatusPlayer -----------------------');
    let param = {};
    if (playerid){
        param = {
            id: playerid, additional: 'song_tag, song_audio, subplayer_volume'
        };
        send('as', 'getStatusRemotePlayerStatus', param, (res) => {
            if (res && res.state){
                let state = res.state;
                if (state === 'playing'){
                    state = 'play';
                } else if (state === 'stopped' || state === 'none'){
                    state = 'stop';
                }
                states.AudioStation.players[playerid].state_playing = state;
                if ((res.state === 'playing' || res.state === 'pause') && res.song){
                    states = parse.RemotePlayerStatus(playerid, states, res);
                    getPlaylist(playerid, () => {
                        getSongCover(playerid);
                    });
                } else {
                    if (states.AudioStation.players[playerid].playlist_total !== 0){
                        clearPlayerStates(playerid);
                    }
                }
            }
            cb && cb(res);
        });
    }
}

function getSongCover(playerid){
    adapter.log.debug('--------------------- getSongCover -----------------------');
    const track = states.AudioStation.players[playerid].song_id;
    if (track !== old_states.AudioStation.players[playerid].song_id){
        old_states.AudioStation.players[playerid].song_id = track;
        send('as', 'getSongCover', {id: track}, (res) => {
            if (res && !res.message){
                let buf = Buffer.from(res, 'binary');
                fs.writeFile(dir + 'cover.jpg', buf, () => {
                    states.AudioStation.players[playerid].cover = dir + 'cover.jpg';
                });
            } else if (res.response.statusCode === 404){
                states.AudioStation.players[playerid].cover = dir + 'cover.png';
            }
        });
    }
}

function getPlaylist(playerid, cb){
    adapter.log.debug('--------------------- getPlaylist -----------------------');
    send('as', 'getPlayListRemotePlayer', {id: playerid}, (res) => {
        if (res){
            states = parse.PlayListRemotePlayer(playerid, states, res);
            cb && cb();
        }
    });
}

function Browser(_states, playerid, val){
    adapter.log.debug('--------------------- Browser -----------------------');
    let param = {};
    if (val && val !== '/'){
        if (~val.indexOf('dir_')){
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

function PlayControl(states, playerid, cmd, val){
    //adapter.log.debug('--------------------- PlayControl -----------------------');
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

function PlayFolder(states, playerid, folder){
    adapter.log.debug('--------------------- PlayFolder -----------------------');
    let param = {};
    if (playerid){
        send('as', 'controlRemotePlayer', {id: playerid, action: 'stop'}, () => {
            clearPlaylist(states, playerid, () => {
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

function PlayTrack(states, playerid, val){
    adapter.log.debug('--------------------- PlayTrack -----------------------');
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

function PlayTrackNum(states, playerid, val){
    adapter.log.debug('--------------------- PlayTrackNum -----------------------');
    if (playerid){
        send('as', 'controlRemotePlayer', {id: playerid, action: 'play', value: val});
    }
}

function PlayTrackId(states, playerid, val){
    adapter.log.debug('--------------------- PlayTrack -----------------------');
    try {
        let arr = JSON.parse(states.AudioStation.players[playerid].playlist);
        let track = arr.findIndex(item => item.id === val);
        if (track){
            send('as', 'controlRemotePlayer', {id: playerid, action: 'play', value: track});
        } else {
            adapter.log.error('PlayTrackId: Error track not found');
        }
    } catch (e) {
        adapter.log.error('PlayTrackId: Error parse playlist');
    }
}

/****************************************************************/
function queuePolling(){
    if (pollAllowed){
        iteration = 0;
        isPoll = true;
        let namePolling = '';
        if (endTime - startTime > slowPollingTime){
            startTime = new Date().getTime();
            namePolling = 'slowPoll';
        } else {
            if (firstStart){
                pollAllowed = false;
                namePolling = 'firstPoll';
            } else {
                namePolling = 'fastPoll';
            }
        }
        adapter.log.debug('slowPollingTime = ' + (endTime - startTime));
        sendPolling(namePolling);
    }
}

function sendPolling(namePolling, cb){
    adapter.log.debug('-----------------------------------------------------------------------------------------------------');
    if (typeof PollCmd[namePolling][iteration] === 'function'){
        states = PollCmd[namePolling][iteration](states);
        iterator(namePolling, cb);
    } else if (states.api[PollCmd[namePolling][iteration].api].installed){
        const api = PollCmd[namePolling][iteration].api;
        const method = PollCmd[namePolling][iteration].method;
        const params = PollCmd[namePolling][iteration].params;
        adapter.log.debug('Получаем информацию из массива (' + namePolling + ') api: ' + api + ' method: ' + method + ' params: ' + JSON.stringify(params));
        try {
            syno[api][method](params, (err, res) => {
                adapter.log.debug(!err && res ? 'Ответ получен, парсим:' :'Нет ответа на команду, читаем следующую.');
                if (!err && res){
                    if (!connect) setInfoConnection(true);
                    connect = true;
                    try {
                        states = PollCmd[namePolling][iteration].ParseFunction(api, states, res);
                    } catch (e) {

                    }
                } else if (err){
                    adapter.log.error('sendPolling Error - ' + err);
                    if (method === 'getPollingData'){
                        iteration = -1;
                    }
                }
                if (queueCmd){
                    queueCmd = false;
                    setTimeout(() => {
                        iterator(namePolling, cb);
                    }, 1000);
                } else {
                    iterator(namePolling, cb);
                }
            });
        } catch (e) {
            error(e);
        }
    } else {
        adapter.log.debug('Packet ' + PollCmd[namePolling][iteration].api + ' non installed, skipped');
        iterator(namePolling, cb);
    }
}

function iterator(namePolling, cb){
    iteration++;
    if (iteration > PollCmd[namePolling].length - 1){
        iteration = 0;
        if (namePolling === 'firstPoll') firstStart = false;
        pollAllowed = true;
        adapter.log.debug('### Все данные прочитали, сохраняем полученные данные. ###');
        isPoll = false;
        setStates();
        timeOutPoll = setTimeout(() => {
            endTime = new Date().getTime();
            queuePolling();
        }, pollTime);
    } else {
        sendPolling(namePolling, cb);
    }
}

function send(api, method, params, cb){
    if (typeof params === 'function'){
        cb = params;
        params = null;
    }
    try {
        syno[api][method](params, (err, data) => {
            adapter.log.debug('Send ' + api + ' ' + method + ' Error: ' + err + ' Response: ' + typeof data);
            data = data || '';
            if (!err){
                cb && cb(data);
            } else if (err){
                error(err, cb);
            }
        });
    } catch (e) {
        adapter.log.error('--- Send Error ' + JSON.stringify(e));
    }
}

function setStates(){
    adapter.log.debug('--------------------- setStates -----------------------');
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
    adapter.log.debug('setObject ' + JSON.stringify(id));
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
            common.read = objects[_id].read || true;
            common.write = objects[_id].write || false;
            common.def = objects[_id].val;
        }
        if ((err || !obj)){
            adapter.setObject(id, {
                type: 'state', common: common, native: {}
            });
            adapter.setState(id, {val: val, ack: true});
        } else {
            if (JSON.stringify(obj.common) !== JSON.stringify(common)){
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

function error(e, cb){
    let code = e.code;
    if (code === 400 || code === 500 || code === 'ECONNREFUSED' || code === 'ETIMEDOUT'){
        timeOutRecconect && clearTimeout(timeOutRecconect);
        setInfoConnection(false);
        connect = false;
        timeOutRecconect = setTimeout(() => {
            queuePolling()
        }, 10000);
    } else {
        cb && cb(e)
    }
    adapter.log.error('*** DEBUG RES ERROR : code(' + code + ') ' + e.message);
}

function main(){
    if (!adapter.systemConfig) return;
    adapter.subscribeStates('*');
    old_states = JSON.parse(JSON.stringify(states));
    setInfoConnection(false);
    startTime = new Date().getTime();
    endTime = new Date().getTime();
    pollTime = adapter.config.polling || 100;
    slowPollingTime = adapter.config.slowPollingTime || 60000;

    parse.on('debug', (msg) => {
        adapter.log.debug('* ' + msg);
    });
    parse.on('info', (msg) => {
        adapter.log.info('* ' + msg);
    });

    dir = utils.controllerDir + '/' + adapter.systemConfig.dataDir + adapter.namespace.replace('.', '_') + '/';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    fs.copyFile('admin/cover.png', dir + 'cover.png', () => {
    });
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
        //console.warn('response[\'sid\'] = ' + response['sid'] + ' OPTIONS - ' + JSON.stringify(options));
        timeOutPoll && clearTimeout(timeOutPoll);
        queuePolling();
    } catch (e) {
        adapter.log.error('Synology Error: ' + e.message);
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

if (module.parent){
    module.exports = startAdapter;
} else {
    startAdapter();
}