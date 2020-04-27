"use strict";

const utils = require('@iobroker/adapter-core');
let Syno = require('syno');
//const tools = require('./lib/tools.js');
const parse = require('./lib/parsers.js');
let adapter, syno, timeOutPoll, connect = false, current_player = '', iteration = 0, isPoll = false, queueCmd = null, startTime, endTime, pollAllowed = true, firstStart = true;
const slowPollingTime = 60000;

function startAdapter(options){
    return adapter = utils.adapter(Object.assign({}, options, {
        systemConfig:   true, name: 'synology', ready: main, unload: callback => {
            timeOutPoll && clearTimeout(timeOutPoll);
            try {
                adapter.log.debug('cleaned everything up...');
                callback();
            } catch (e) {
                callback();
            }
        }, stateChange: (id, state) => {
            if (id && state && !state.ack){
                adapter.log.debug(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
                let ids = id.split(".");
                let name = ids[ids.length - 2].toString();
                let command = ids[ids.length - 1].toString();
                let val = state.val;
                if (command === 'reboot'){
                    send('dsm', 'rebootSystem', (res) => {
                        adapter.log.debug('System reboot');
                        timeOutPoll && clearTimeout(timeOutPoll);
                        setInfoConnection(false);
                        connect = false;
                        timeOutPoll = setTimeout(() => {
                            endTime = new Date().getTime();
                            queuePolling();
                        }, 500);
                    });
                    return;
                }
                if (command === 'shutdown'){
                    send('dsm', 'shutdownSystem', (res) => {
                        adapter.log.debug('System shutdown');
                        timeOutPoll && clearTimeout(timeOutPoll);
                        setInfoConnection(false);
                        connect = false;
                        timeOutPoll = setTimeout(() => {
                            endTime = new Date().getTime();
                            queuePolling();
                        }, 500);
                    });
                    return;
                }
                if (command === 'Browser'){  /*  /AS  */
                    queueCmd = function (_states, cb){
                        Browser(_states, name, val, (_states) => {
                            cb && cb(_states);
                        });
                    }
                } else if (command === 'play_folder'){
                    PlayFolder(syno, states, name, val);
                } else if (command === 'play_track'){
                    PlayTrack(syno, states, name, val);
                } else if (command === 'stop' || command === 'next' || command === 'prev' || command === 'volume' || command === 'seek' || command === 'pause' || command === 'play' || command === 'repeat' || command === 'shuffle'){
                    PlayControl(syno, states, name, command, val);
                } else if (command === 'getSnapshotCamera'){
                    getSnapshotCamera(val);
                } else if (command === 'add_url_download'){
                    addDownload(val);
                } else {
                    if (states.api[name]){
                        if (states.api[name].installed){
                            //{"method":"getStatusRemotePlayer", "params":{"id": "uuid:90290a7d-f6cf-f783-84d9-30f315a97db9"}}
                            let json, param;
                            try {
                                json = JSON.parse(val);
                                if (!json.method){
                                    throw new SyntaxError("Error command");
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
        }
    }));
}

let states = {
    'DiskStationManager':  {'info': {}, 'hdd_info': {}, 'vol_info': {}},
    'FileStation':         {'info': {}},
    'DownloadStation':     {'info': {}},
    'AudioStation':        {'info': {}, 'players': {}},
    'VideoStation':        {'info': {}},
    'VideoStation_DTV':    {'info': {}},
    'SurveillanceStation': {'info': {}, 'cameras': {}},
    api:                   {
        'dsm': {name: 'DiskStationManager', polldata: [], installed: true},
        'fs':  {name: 'FileStation', polldata: [], installed: true},
        'dl':  {name: 'DownloadStation', polldata: [], installed: false},
        'as':  {name: 'AudioStation', polldata: [], installed: false},
        'vs':  {name: 'VideoStation', polldata: [], installed: false},
        'dtv': {name: 'dtVideoStation_DTV', polldata: [], installed: false},
        'ss':  {name: 'SurveillanceStation', polldata: [], installed: false}
    }
};
let old_states = {
    'DiskStationManager':  {'info': {}, 'hdd_info': {}, 'vol_info': {}},
    'FileStation':         {'info': {}},
    'DownloadStation':     {'info': {}},
    'AudioStation':        {'info': {}, 'players': {}},
    'VideoStation':        {'info': {}},
    'VideoStation_DTV':    {'info': {}},
    'SurveillanceStation': {'info': {}, 'cameras': {}},
    api:                   {
        'dsm': {name: 'DiskStationManager', polldata: [], installed: true},
        'fs':  {name: 'FileStation', polldata: [], installed: true},
        'dl':  {name: 'DownloadStation', polldata: [], installed: false},
        'as':  {name: 'AudioStation', polldata: [], installed: false},
        'vs':  {name: 'VideoStation', polldata: [], installed: false},
        'dtv': {name: 'dtVideoStation_DTV', polldata: [], installed: false},
        'ss':  {name: 'SurveillanceStation', polldata: [], installed: false}
    }
};

const objects = {
    //action: set_shuffle value: false
    //action: set_shuffle value: true
    current_duration: {role: "media.duration.text", name: "playback duration", type: "string", read: true, write: false, def: ""},
    current_elapsed:  {role: "media.elapsed.text", name: "playback elapsed", type: "string", read: true, write: false, def: ""},
    duration:         {role: "media.duration.text", name: "duration track", type: "string", read: true, write: false, def: ""},
    seek:             {role: "media.seek", name: "Controlling playback seek", type: "number", unit: "%", min: 0, max: 100, read: true, write: true, def: ""},
    volume:           {role: "level.volume", name: "volume", type: "number", min: 0, max: 100, read: true, write: true, def: ""},
    playlist:         {role: "media.playlist", name: "AudioStation playlist", type: "string", read: true, write: true, def: ""},
    repeat:           {role: "media.mode.repeat", name: "Repeat control", type: "string", read: true, write: true, states: {none: "Off", all: "All", one: "One"}, def: ""},
    shuffle:          {role: "media.mode.shuffle", name: "Shuffle control", type: "boolean", read: true, write: true, def: ""},
    prev:             {role: "button.prev", name: "Controlling playback previous", type: "boolean", read: false, write: true, def: ""},
    next:             {role: "button.next", name: "Controlling playback next", type: "boolean", read: false, write: true, def: ""},
    stop:             {role: "button.stop", name: "Controlling playback stop", type: "boolean", read: false, write: true, def: ""},
    pause:            {role: "button.pause", name: "Controlling playback pause", type: "boolean", read: false, write: true, def: ""},
    play:             {role: "button.play", name: "Controlling playback play", type: "boolean", read: false, write: true, def: ""},
    memory_usage:     {role: "state", name: "memory_usage", type: "number", unit: "%", read: true, write: false, def: ""},
    cpu_load:         {role: "state", name: "cpu_load", type: "number", unit: "%", read: true, write: false, def: ""},
    used:             {role: "state", name: "used", type: "number", unit: "%", read: true, write: false, def: ""},
    ram:              {role: "state", name: "ram", type: "number", unit: "MB", read: true, write: false, def: ""},
    capacity:         {role: "state", name: "capacity", type: "number", unit: "GB", read: true, write: false, def: ""},
    total_size:       {role: "state", name: "total_size", type: "number", unit: "GB", read: true, write: false, def: ""},
    used_size:        {role: "state", name: "used_size", type: "number", unit: "GB", read: true, write: false, def: ""},
    temperature:      {role: "state", name: "temperature", type: "number", unit: "°C", read: true, write: false, def: ""},
    Browser:          {role: "state", name: "AudioStation Browser Files", type: "object", read: true, write: true, def: ""},
    play_folder:      {role: "state", name: "play_folder", type: "string", read: true, write: true, def: ""},
    play_track:       {role: "state", name: "play_track", type: "string", read: true, write: true, def: ""},

};

//http://192.168.1.101:5000/webapi/entry.cgi?api=SYNO.SurveillanceStation.HomeMode&version=1&method=Switch&on=true&_sid=Gj.tXLURyrKZg1510MPN674502

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
        {api: 'as', method: 'listRemotePlayers', params: {}, ParseFunction: parse.ListRemotePlayers}
    ],
    "fastPoll":  [
        {api: 'dsm', method: 'getSystemUtilization', params: {}, ParseFunction: parse.SystemUtilization},
        {api: 'dsm', method: 'getSystemStatus', params: {}, ParseFunction: parse.SystemStatus},
        {api: 'dsm', method: 'infoSystem', params: {type: "storage", version: 1}, ParseFunction: parse.InfoSystem},
        getStatusRemotePlayers
    ],
    "slowPoll":  [
        {api: 'dsm', method: 'getPollingData', params: {}, ParseFunction: parse.InstallingPackets}
    ]
};

function getStatusRemotePlayers(states){
    adapter.log.debug('--------------------- getStatusPlayer -----------------------');
    Object.keys(states.AudioStation.players).forEach((playerid) => {
        getStatusPlayer(playerid, (res) => {
            //console.log(res);
        });
    });
    return states;
}

function clearPlayerStates(playerid){
    states.AudioStation.players[playerid].playlist_total = '';
    states.AudioStation.players[playerid].volume = 0;
    states.AudioStation.players[playerid].album = '';
    states.AudioStation.players[playerid].artist = '';
    states.AudioStation.players[playerid].genre = '';
    states.AudioStation.players[playerid].year = 0;
    states.AudioStation.players[playerid].song_id = '';
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
}

function getStatusPlayer(playerid, cb){
    let param = {};
    if (playerid){
        param = {
            id: playerid, additional: 'song_tag, song_audio, subplayer_volume'
        };
        send('as', 'getStatusRemotePlayerStatus', param, (res) => {
            states.AudioStation.players[playerid].state_playing = res.state;
            let state = res.state;
            if (state === 'playing'){
                state = 'play';
            } else if (state === 'stopped'){
                state = 'stop';
            }
            states.AudioStation.players[playerid].status = state;
            if ((res.state === 'playing' || res.state === 'pause') && res.song){
                states = parse.RemotePlayerStatus(playerid, states, res);
                send('as', 'getPlayListRemotePlayer', param, (res) => {
                    if (res){
                        states = parse.PlayListRemotePlayer(playerid, states, res);
                    }
                });
            } else {
                clearPlayerStates(playerid);
            }
            cb && cb(res);
        });
    }
}

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
                    setInfoConnection(true);
                    states = PollCmd[namePolling][iteration].ParseFunction(api, states, res);
                } else if (err){
                    adapter.log.error('Error - ' + err);
                }
                if (queueCmd){
                    adapter.log.debug('* Get queueCmd *');
                    queueCmd(states, (res) => {
                        adapter.log.debug('queueCmd Response: '/* + JSON.stringify(res)*/);
                        states = res;
                        queueCmd = null;
                        iterator(namePolling, cb);
                    });
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
        }, 500);
    } else {
        sendPolling(namePolling, cb);
    }
}

//////////////////////////* SurveillanceStation */////////////////////
function listEvents(cb){
    //{"events":[],"offset":0,"timestamp":"1507648068","total":0}

    /*let param = {
        camId: 2
        //cameraIds:"2",
        //blIncludeDeletedCam:true,
        //deviceOutCap:true,
        //streamInfo:true,
        //ptz:true,
        //basic:true,
        //privCamType:3,
        //camAppInfo:true,
        //optimize:true,
        //fisheye:true,
        //eventDetection:true
    };*/
    let param = {
        start: 0, limit: 100, version: 1
    };
    //send('ss', 'getInfoCamera', param, function (res){
    send('ss', 'listHistoryActionRules', param, (res) => {
        if (res){
            states.SurveillanceStation.events = JSON.stringify(res);
            adapter.log.error('****************** ' + JSON.stringify(res));
        }
        cb && cb();
    });
}

function listCameras(cb){
    adapter.log.debug('--------------------- listCameras -----------------------');
    let param = {
        basic: true
    };
    send('ss', 'listCameras', param, (res) => {
        if (res){
            let arr = res.cameras;
            arr.forEach((k, i) => {
                states.SurveillanceStation.cameras[arr[i].name] = {
                    host: arr[i].host, id: arr[i].id, port: arr[i].port, model: arr[i].model, status: CamStatus(arr[i].status), recStatus: arr[i].recStatus, snapshot_path: arr[i].snapshot_path, enabled: arr[i].enabled
                }
            });
        }
        cb && cb();
    });
}

/**
 * @return {string}
 */
function CamStatus(status){
    adapter.log.debug('--------------------- CamStatus -----------------------');
    //0: ENABLED• 1: DISABLED• 2: ACCTIVATING• 3: DISABLING• 4: RESTARTING• 5: UNKNOWN
    switch (status) {
        case 0:
            status = 'ENABLED';
            break;
        case 1:
            status = 'DISABLED';
            break;
        case 2:
            status = 'ACCTIVATING';
            break;
        case 3:
            status = 'DISABLING';
            break;
        case 4:
            status = 'RESTARTING';
            break;
        case 5:
            status = 'UNKNOWN';
            break;
        default:
    }
    return status;
}

function getSnapshotCamera(camid, cb){
    adapter.log.debug('--------------------- getSnapshotCamera -----------------------');
    //let decodedImage = new Buffer(encodedImage, 'base64').toString('binary');
    //{"method":"getSnapshotCamera", "params":{"cameraId":2, "camStm": 1, "preview": true}}
    if (camid){
        let param = {
            'cameraId': camid
        };
        send('ss', 'getSnapshotCamera', param, (res) => {
            if (res){
            }
            cb && cb();
        });
    }
}

function listSnapShots(cb){
    //{"auInfo":{"cms":null,"deleteByRecordId":{"data":[]},"serverAction":{"0":null,"1":null,"2":null,"3":null,"4":null,"5":null},"timestamp":1507218967,"volumeAction":null},"data":[],"recCntData":{"recCnt":{"date":{"-1":0}},"total":0},"timestamp":"1507650252","total":0}
    send('ss', 'listSnapShots', (res) => {
        if (res){
            states.SurveillanceStation.snapshots_list = JSON.stringify(res.data);
        }
        cb && cb();
    });
}

function loadSnapShot(id, cb){
    if (id){
        let param = {
            id: id, imgSize: 2
            /*
             0: Do not append image
             1: Icon size
             2: Full size
             */
        };
        send('ss', 'loadSnapShot', param, (res) => {
            if (res){

            }
            cb && cb();
        });
    }
}

/////////////////////////* DownloadStation */////////////////////////
function addDownload(url, cb){
    adapter.log.debug('--------------------- addDownload -----------------------');
    let param = {
        type: "url", create_list: true, uri: [url], version: 2
    };
    adapter.getState('AudioStation.folder', (err, state) => {
        if ((err || !state)){
        } else {
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
function Browser(_states, playerid, val, cb){
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
        _states.AudioStation.players[playerid].Browser = JSON.stringify(arr);
        cb && cb(_states);
    });
}

function PlayControl(syno, states, playerid, cmd, val, cb){
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
        if (cmd === 'seek'){ //value: 174.6066
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
        //adapter.log.debug('PlayControl cmd - ' + cmd + '. param - ' + JSON.stringify(param));
        send('as', 'controlRemotePlayer', param, (res) => {
            //cb && cb();
        });
    }
}

function PlayFolder(syno, states, playerid, folder, cb){
    //adapter.log.debug('--------------------- PlayFolder -----------------------');
    let param = {};
    if (playerid){
        param = {
            id:              playerid,
            library:         'shared',
            offset:          0,
            limit:           1,
            play:            true,
            containers_json: [
                {
                    "type":           "folder",
                    "id":             folder,
                    "recursive":      true,
                    "sort_by":        "title",
                    "sort_direction": "ASC"
                }]
        };
        send('as', 'updatePlayListRemotePlayer', param, (res) => {
            param = {
                id:     playerid,
                action: 'play'
            };
            send('as', 'controlRemotePlayer', param, (res) => {
            });
        });
    }
}

function PlayTrack(syno, states, playerid, val, cb){
    //adapter.log.debug('--------------------- PlayTrack -----------------------');
    let param = {};
    if (playerid){
        param = {
            id:              playerid,
            library:         'shared',
            offset:          0,
            limit:           1,
            play:            true,
            songs:           val,
            containers_json: []
        };
        send('as', 'updatePlayListRemotePlayer', param, (res) => {
            param = {
                id:     playerid,
                action: 'play'
            };
            send('as', 'controlRemotePlayer', param, (res) => {
            });
        });
    }
}

/*************************************************************/

function send(api, method, params, cb){
    if (typeof params == 'function'){
        cb = params;
        params = null;
    }
    try {
        syno[api][method](params, (err, data) => {
            //adapter.log.debug('---DEBUG RES DATA--- :{"api": ' + api + ', "method": ' + method + ' } \r\nRESPONSE: ' + JSON.stringify(data));
            data = data || '';
            if (!err){
                cb && cb(data);
            } else {
                err && error(err);
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
            adapter.setState(id, {
                val: val, ack: true
            });
        } else {
            adapter.extendObject(id, {common: common});
            adapter.getState(id, function (err, state){
                if (!err && state !== null){
                    if (state.val === val){
                        //adapter.log.debug('setState ' + name + ' { oldVal: ' + state.val + ' = newVal: ' + val + ' }');
                    } else if (state.val !== val){
                        adapter.setState(id, {
                            val: val, ack: true
                        });
                        adapter.log.debug('setState ' + id + ' { oldVal: ' + state.val + ' != newVal: ' + val + ' }');
                    }
                } else {
                    adapter.log.debug('setState error ' + id);
                }
            });
        }
    });
    objects
}

function error(e){
    let code = e.code;
    let err = '';
    if (code !== 'ECONNREFUSED'){
        switch (code) {
            case 100:
                err = '100';
                break;
            case 101:
                err = 'No parameter of API, method or version';
                break;
            case 102:
                err = 'The requested API does not exist';
                break;
            case 103:
                err = 'The requested method does not exist';
                break;
            case 104:
                err = 'The requested version does not support the functionality';
                break;
            case 105:
                err = 'The logged in session does not have permission';
                break;
            case 106:
                err = 'Session timeout';
                break;
            case 107:
                err = 'Session interrupted by duplicate login';
                break;
            case 119:
                err = '119';
                break;
            case 400:
                err = 'Error connection/Execution failed (error password?)';
                break;
            case 401:
                err = 'Parameter invalid';
                break;
            case 405:
                err = '{"error":{"code":405},"success":false}';
                break;
            case 450:
                err = '450';
                break;
            case 500:
                err = '500'; //controlRemotePlayer
                break;
            /*default:
                return 'Unknown error';*/
        }
    }
    if (code === 400 || code === 500 || code === 'ECONNREFUSED' || code === 'ETIMEDOUT'){
        timeOutPoll && clearTimeout(timeOutPoll);
        setInfoConnection(false);
        connect = false;
        timeOutPoll = setTimeout(() => {
            queuePolling()
        }, 1000);
    }
    adapter.log.error('*** DEBUG RES ERR : code(' + code + ') ' + JSON.stringify(err));
}

function main(){
    adapter.subscribeStates('*');
    startTime = new Date().getTime();
    endTime = new Date().getTime();
    parse.on('debug', (msg) => {
        adapter.log.debug('* ' + msg);
    });
    parse.on('info', (msg) => {
        adapter.log.info('* ' + msg);
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

if (module.parent){
    module.exports = startAdapter;
} else {
    startAdapter();
}