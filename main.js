"use strict";
const utils = require('@iobroker/adapter-core');
let Syno = require('syno');
const fs = require('fs');
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
                        queueCmd = Browser(states, name, val);
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
                } else if (command === 'stop' || command === 'next' || command === 'prev' || command === 'volume' || command === 'seek' || command === 'pause' || command === 'play' || command === 'repeat' || command === 'shuffle'){
                    PlayControl(states, name, command, val);
                } else if (command === 'getSnapshotCamera'){
                    getSnapshotCamera(val);
                } else if (command === 'add_url_download'){
                    addDownload(val);
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
    current_duration: {role: "media.duration.text", name: "Playback duration", type: "string", read: true, write: false, def: ""},
    current_elapsed:  {role: "media.elapsed.text", name: "Playback elapsed", type: "string", read: true, write: false, def: ""},
    current_play:     {role: "media.track", name: "Controlling and state current play track number", type: "string", read: true, write: true, def: ""},
    song_id:          {role: "media.playid", name: "Controlling and state current play track id", type: "number", read: true, write: true, def: ""},
    artist:           {role: "media.artist", name: "Artist", type: "string", read: true, write: false, def: ""},
    album:            {role: "media.album", name: "Album", type: "string", read: true, write: false, def: ""},
    title:            {role: "media.title", name: "Title", type: "string", read: true, write: false, def: ""},
    genre:            {role: "media.genre", name: "Genre", type: "string", read: true, write: false, def: ""},
    year:             {role: "media.date", name: "Year", type: "string", read: true, write: false, def: ""},
    path:             {role: "media", name: "Path track", type: "string", read: true, write: false, def: ""},
    player_name:      {role: "media", name: "Remote player name", type: "string", read: true, write: false, def: ""},
    playlist_total:   {role: "media", name: "Number of tracks in the playlist", type: "string", read: true, write: false, def: ""},
    duration_sec:     {role: "media.duration", name: "Duration track in secunds", type: "number", read: true, write: false, def: ""},
    duration:         {role: "media.duration.text", name: "Duration track", type: "string", read: true, write: false, def: ""},
    bitrate:          {role: "media.bitrate", name: "bitrate", type: "string", unit: "kbps", read: true, write: false, def: ""},
    seek:             {role: "media.seek", name: "Controlling playback seek", type: "number", unit: "%", min: 0, max: 100, read: true, write: true, def: ""},
    volume:           {role: "level.volume", name: "Volume", type: "number", min: 0, max: 100, read: true, write: true, def: ""},
    subplayer_volume: {role: "level.volume", name: "Subplayer volume if supported", type: "number", min: 0, max: 100, read: true, write: true, def: ""},
    playlist:         {role: "media.playlist", name: "AudioStation playlist", type: "string", read: true, write: true, def: ""},
    repeat:           {role: "media.mode.repeat", name: "Repeat control", type: "string", read: true, write: true, states: {none: "Off", all: "All", one: "One"}, def: ""},
    shuffle:          {role: "media.mode.shuffle", name: "Shuffle control", type: "boolean", read: true, write: true, def: ""},
    prev:             {role: "button.prev", name: "Controlling playback previous", type: "boolean", read: false, write: true, def: ""},
    next:             {role: "button.next", name: "Controlling playback next", type: "boolean", read: false, write: true, def: ""},
    stop:             {role: "button.stop", name: "Controlling playback stop", type: "boolean", read: false, write: true, def: ""},
    pause:            {role: "button.pause", name: "Controlling playback pause", type: "boolean", read: false, write: true, def: ""},
    play:             {role: "button.play", name: "Controlling playback play", type: "boolean", read: false, write: true, def: ""},
    state_playing:    {role: "media.state", name: "Status Play, stop, or pause", type: "string", read: true, write: false, def: ""},
    memory_usage:     {role: "state", name: "Memory usage", type: "number", unit: "%", read: true, write: false, def: ""},
    cpu_load:         {role: "state", name: "Cpu load", type: "number", unit: "%", read: true, write: false, def: ""},
    used:             {role: "state", name: "Used", type: "number", unit: "%", read: true, write: false, def: ""},
    ram:              {role: "state", name: "Ram", type: "number", unit: "MB", read: true, write: false, def: ""},
    capacity:         {role: "state", name: "Capacity", type: "number", unit: "GB", read: true, write: false, def: ""},
    total_size:       {role: "state", name: "Total size", type: "number", unit: "GB", read: true, write: false, def: ""},
    used_size:        {role: "state", name: "Used size", type: "number", unit: "GB", read: true, write: false, def: ""},
    temperature:      {role: "state", name: "Temperature", type: "number", unit: "°C", read: true, write: false, def: ""},
    Browser:          {role: "state", name: "AudioStation Browser Files", type: "object", read: true, write: true, def: ""},
    play_folder:      {role: "state", name: "Add tracks from the folder to the playlist", type: "string", read: true, write: true, def: ""},
    play_track:       {role: "state", name: "Play track by its id", type: "string", read: true, write: true, def: ""},
    status_on:        {role: "state", name: "HomeMode status", type: "boolean", read: true, write: true, def: ""},
    enabled:          {role: "state", name: "Is enabled", type: "boolean", read: true, write: true, def: ""},
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
        {api: 'dsm', method: 'infoSystem', params: {type: "storage", version: 1}, ParseFunction: parse.InfoSystem},
        getStatusRemotePlayers,
        {api: 'ss', method: 'getInfoHomeMode', params: {need_mobiles: true}, ParseFunction: parse.InfoHomeMode},
        //{api: 'ss', method: 'listEvents', params: {reason: 2, limit: 10, cameraIds: '2'}, ParseFunction: parse.dIStsPollIngCameraEvent},
        //{api: 'ss', method: 'getInfoCamera', params: {basic: true, cameraIds: '2', eventDetection: true, privCamType: 3, camAppInfo: true, version: 8}, ParseFunction: parse.dIStsPollIngCameraEvent},
        //{api: 'ss', method: 'OneTimeCameraStatus', params: {id_list: "2"}, ParseFunction: parse.dIStsPollIngCameraEvent},
    ],//triggerAlert
    "slowPoll":  [
        {api: 'as', method: 'listRemotePlayers', params: {}, ParseFunction: parse.ListRemotePlayers},
        {api: 'ss', method: 'listCameras', params: {basic: true, version: 7}, ParseFunction: parse.listCameras},
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

const getNameCams = (id) => {
    for (let nameCam in states.SurveillanceStation.cameras) {
        if (!states.SurveillanceStation.cameras.hasOwnProperty(nameCam)) continue;
        if (states.SurveillanceStation.cameras[nameCam].id === id){
            return nameCam;
        }
    }
};

function switchCam(states, name, command, val){
    let method = !!val ? 'enableCamera' :'disableCamera';
    if (name !== 'undefined'){
        let camId = states.SurveillanceStation.cameras[name].id.toString();
        send('ss', method, {cameraIds: camId, blIncludeDeletedCam: false}, (res) => {
        });
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
function addDownload(url, cb){
    adapter.log.debug('--------------------- addDownload -----------------------');
    let param = {
        type: "url", create_list: true, uri: [url], version: 2
    };
    adapter.getState('AudioStation.folder', (err, state) => {
        if (!err || state){
            param.destination = state.val;
        }
    });
    send('dl', 'createTask', param, (res) => {
        if (res){
            adapter.log.error('****************** ' + JSON.stringify(res));
        }
        cb && cb();
    });
}

////////////////////////* AudioStation *////////////////////////////
function getStatusRemotePlayers(states){
    adapter.log.debug('--------------------- getStatusPlayer -----------------------');
    Object.keys(states.AudioStation.players).forEach((playerid) => {
        getStatusPlayer(playerid);
    });
    return states;
}

function clearPlayerStates(playerid){
    adapter.log.debug('-------- clearPlayerStates ----------');
    states.AudioStation.players[playerid].playlist_total = '';
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
    let param = {};
    if (playerid){
        param = {
            id: playerid, additional: 'song_tag, song_audio, subplayer_volume, song_rating'
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
                    send('as', 'getPlayListRemotePlayer', param, (res) => {
                        if (res){
                            states = parse.PlayListRemotePlayer(playerid, states, res);
                            let track = states.AudioStation.players[playerid].song_id;
                            if (track !== old_states.AudioStation.players[playerid].song_id){
                                old_states.AudioStation.players[playerid].song_id = track;
                                send('as', 'getSongCover', {id: track}, (res) => {
                                    if (res && !res.message){
                                        let buf = Buffer.from(res, 'binary');
                                        fs.writeFile(dir + 'cover.jpg', buf, (err) => {
                                            states.AudioStation.players[playerid].cover = dir + 'cover.jpg';
                                        });
                                    }
                                });
                            }
                        }
                    });
                } else {
                    if(states.AudioStation.players[playerid].playlist_total !== 0){
                        clearPlayerStates(playerid);   
                    }
                }
            }
            cb && cb(res);
        });
    }
}

function Browser(states, playerid, val){
    adapter.log.debug('--------------------- Browser -----------------------');
    let param = {};
    if (val && val !== '/'){
        param = {id: val};
    }
    send('as', 'listFolders', param, (res) => {
        let arr = [];
        res.items.forEach((k, i) => {
            let filetype = 'file';
            if (res.items[i].type === 'folder'){
                filetype = 'directory';
            }
            arr.push({
                "id":       res.items[i].id,
                "file":     res.items[i].path,
                "filetype": filetype,
                "title":    res.items[i].title
            });
        });
        states.AudioStation.players[playerid].Browser = JSON.stringify(arr);
        return states;
    });
}

function PlayControl(states, playerid, cmd, val, cb){
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

function PlayFolder(states, playerid, folder, cb){
    //adapter.log.debug('--------------------- PlayFolder -----------------------');
    let param = {};
    if (playerid){
        send('as', 'controlRemotePlayer', {id: playerid, action: 'stop'}, (res) => {
            param = {
                id:            playerid,
                offset:        0,
                songs:         '',
                limit:         states.AudioStation.players[playerid].playlist_total || 10000,
                updated_index: -1
            };
            send('as', 'updatePlayListRemotePlayer', param, (res) => { //clear playlist
                param = {
                    id:                 playerid,
                    library:            'shared',
                    keep_shuffle_order: false,
                    offset:             0,
                    limit:              0,
                    play:               true,
                    containers_json:    JSON.stringify([{"type": "folder", "id": folder, "recursive": true, "sort_by": "title", "sort_direction": "ASC"}])
                };
                send('as', 'updatePlayListRemotePlayer', param, (res) => { //add folder to playlist
                    param = {
                        id:     playerid,
                        action: 'play'
                    };
                    send('as', 'controlRemotePlayer', param, (res) => {
                    });
                });
            });
        });
    }
}

function PlayTrack(states, playerid, val, cb){
    adapter.log.debug('--------------------- PlayTrack -----------------------');
    let param = {};
    if (playerid){
        param = {
            id:              playerid,
            library:         'shared',
            offset:          0,
            limit:           1,
            play:            true,
            songs:           val,
            containers_json: JSON.stringify([])
        };
        send('as', 'updatePlayListRemotePlayer', param, (res) => { //updatesongsPlaylist
            param = {
                id:     playerid,
                action: 'play'
            };
            send('as', 'controlRemotePlayer', param, (res) => {
            });
        });
    }
}

function PlayTrackNum(states, playerid, val, cb){
    adapter.log.debug('--------------------- PlayTrackNum -----------------------');
    //action: play value: 2005
    let param = {};
    if (playerid){
        param = {
            id:     playerid,
            action: 'play',
            value:  val
        };
        send('as', 'controlRemotePlayer', param, (res) => {
        });
    }
}

function PlayTrackId(states, playerid, val, cb){
    adapter.log.debug('--------------------- PlayTrack -----------------------');
    try {
        let arr = JSON.parse(states.AudioStation.players[playerid].playlist);
        let track = arr.findIndex(item => item.id === val);
        if (track){
            send('as', 'controlRemotePlayer', {id: playerid, action: 'play', value: track}, (res) => {
            });
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
                    connect = true;
                    setInfoConnection(true);
                    states = PollCmd[namePolling][iteration].ParseFunction(api, states, res);
                } else if (err){
                    adapter.log.error('Error - ' + err);
                }
                if (queueCmd){
                    adapter.log.debug('* Get queueCmd *');
                    states = queueCmd;
                    queueCmd = null;
                    iterator(namePolling, cb);
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
    let type = 'string';
    let role = 'state';
    adapter.log.debug('setObject ' + JSON.stringify(id));
    adapter.getObject(id, function (err, obj){
        let common = {
            name: id, desc: id, type: 'string', role: 'state'
        };
        let _id = id.split('.');
        _id = _id[_id.length - 1];
        if (objects[_id] !== undefined){
            //current_duration: {role: "media.duration.text", name: "playback duration", type: "string", read: true, write: true, def: ""}
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
            //adapter.log.debug('setState ' + id + ' { oldVal: ' + old_states[id] + ' != newVal: ' + val + ' }');
            /*adapter.getState(id, function (err, state){
                if (!err && state !== null){
                    if (!state.ack || state.val !== val){
                        adapter.setState(id, {val: val, ack: true});
                        adapter.log.debug('setState ' + id + ' { oldVal: ' + state.val + ' != newVal: ' + val + ' }');
                    }
                } else {
                    adapter.log.debug('setState error ' + id);
                }
            });*/
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

    try {
        syno = new Syno({
            ignoreCertificateErrors: true, /*rejectUnauthorized: false,*/
            host:                    adapter.config.host || '127.0.0.1',
            port:                    adapter.config.port || '5000',
            account:                 adapter.config.login || 'admin',
            passwd:                  adapter.config.password || '',
            protocol:                adapter.config.https ? 'https' :'http',
            apiVersion:              adapter.config.version || '6.2.2',
            otp:                     'ASE32YJSBKUOIDPB',
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