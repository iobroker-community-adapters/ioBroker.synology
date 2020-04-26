"use strict";

const utils = require('@iobroker/adapter-core');
let Syno = require('syno');
const as = require('./lib/as.js');
let adapter, timeOutPoll, connect = false;
let current_player = '';
let syno;
let iteration = 0, isPoll = false, queueCmd = null, startTime, endTime, pollAllowed = true, firstStart = true;
const slowPollingTime = 60000;

function startAdapter(options) {
    return adapter = utils.adapter(Object.assign({}, options, {
        systemConfig: true,
        name: 'synology',
        ready: main,
        unload: callback => {
            timeOutPoll && clearTimeout(timeOutPoll);
            try {
                adapter.log.debug('cleaned everything up...');
                callback();
            } catch (e) {
                callback();
            }
        },
        stateChange: (id, state) => {
            if (id && state && !state.ack) {
                adapter.log.debug(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
                let ids = id.split(".");
                let name = ids[ids.length - 2].toString();
                let command = ids[ids.length - 1].toString();
                let val = state.val;
                if (command === 'reboot') {
                    name = 'DiskStationManager';
                    val = 'rebootSystem';
                    send(api[name]['name'], val, (res) => {
                        adapter.log.debug('System reboot');
                        //timeOutPoll && clearTimeout(timeOutPoll);
                        adapter.setState('info.connection', false, true);
                        connect = false;
                        /*timeOutPoll = setTimeout(() => {
                            //polling();
                        }, 30000);*/
                    });
                    return;
                }
                if (command === 'shutdown') {
                    name = 'DiskStationManager';
                    val = 'shutdownSystem';
                    send(api[name]['name'], val, (res) => {
                        adapter.log.debug('System shutdown');

                        //timeOutPoll && clearTimeout(timeOutPoll);
                        adapter.setState('info.connection', false, true);
                        connect = false;
                        /*timeOutPoll = setTimeout(() => {
                            //polling();
                        }, 30000);*/
                    });
                    return;
                }
                if (command === 'Browser') {  /*  /AS  */
                    Browser(val);
                } else if (command === 'play_folder') {
                    let a = val.split(',');
                    PlayFolder(a[0], a[1]);
                } else if (command === 'play_track') {
                    let s = val.split(',');
                    PlayTrack(s[0], s[1]);
                } else if (command === 'stop' || command === 'next' || command === 'prev') {
                    PlayControl(command);
                } else if (command === 'selected_player') {
                    current_player = val;  /*  /AS  */
                } else if (command === 'volume') {
                    PlayControl('set_volume', val);  /*  /AS  */
                } else if (command === 'seek') {
                    PlayControl(command, val);  /*  /AS  */
                } else if (command === 'getSnapshotCamera') {
                    getSnapshotCamera(val);
                } else if (command === 'add_url_download') {
                    addDownload(val);
                } else {
                    if (api[name]) {
                        if (api[name].installed) {
                            //{"method":"getStatusRemotePlayer", "params":{"id": "uuid:90290a7d-f6cf-f783-84d9-30f315a97db9"}}
                            let json, param;
                            try {
                                json = JSON.parse(val);
                                if (!json.method) {
                                    throw new SyntaxError("Error command");
                                } else {
                                    val = json.method;
                                    if (typeof json.params === 'object') {
                                        param = json.params;
                                    } else {
                                        param = {};
                                    }
                                    send(api[name]['name'], val, param, (res) => {
                                        if (res) {
                                            let id = name + '.sendMethod';
                                            adapter.setState(id, {
                                                val: JSON.stringify(res),
                                                ack: true
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
    'DiskStationManager': {
        'info': {},
        'hdd_info': {},
        'vol_info': {}
    },
    'FileStation': {'info': {}},
    'DownloadStation': {'info': {}},
    'AudioStation': {
        'info': {},
        'players': {},
        'Browser': ''
    },
    'VideoStation': {'info': {}},
    'VideoStation_DTV': {'info': {}},
    'SurveillanceStation': {
        'info': {},
        'cameras': {}
    },
    api: {
        'dsm': {
            name: 'DiskStationManager',
            polldata: [],
            installed: true
        },
        'fs': {
            name: 'FileStation',
            polldata: [],
            installed: false
        },
        'dl': {
            name: 'DownloadStation',
            polldata: [],
            installed: false
        },
        'as': {
            name: 'AudioStation',
            polldata: [],
            installed: false
        },
        'vs': {
            name: 'VideoStation',
            polldata: [],
            installed: false
        },
        'dtv': {
            name: 'dtVideoStation_DTV',
            polldata: [],
            installed: false
        },
        'ss': {
            name: 'SurveillanceStation',
            polldata: [],
            installed: false
        }
    }
};
let old_states = {
    'DiskStationManager': {
        'info': {},
        'hdd_info': {},
        'vol_info': {}
    },
    'FileStation': {'info': {}},
    'DownloadStation': {'info': {}},
    'AudioStation': {
        'info': {},
        'players': {},
        'Browser': ''
    },
    'VideoStation': {'info': {}},
    'VideoStation_DTV': {'info': {}},
    'SurveillanceStation': {
        'info': {},
        'cameras': {}
    },
    api: {
        'dsm': {
            name: 'DiskStationManager',
            polldata: [],
            installed: true
        },
        'fs': {
            name: 'FileStation',
            polldata: [],
            installed: false
        },
        'dl': {
            name: 'DownloadStation',
            polldata: [],
            installed: false
        },
        'as': {
            name: 'AudioStation',
            polldata: [],
            installed: false
        },
        'vs': {
            name: 'VideoStation',
            polldata: [],
            installed: false
        },
        'dtv': {
            name: 'dtVideoStation_DTV',
            polldata: [],
            installed: false
        },
        'ss': {
            name: 'SurveillanceStation',
            polldata: [],
            installed: false
        }
    }
};

//http://192.168.1.101:5000/webapi/entry.cgi?api=SYNO.SurveillanceStation.HomeMode&version=1&method=Switch&on=true&_sid=Gj.tXLURyrKZg1510MPN674502

function main() {
    adapter.subscribeStates('*');
    startTime = new Date().getTime();
    endTime = new Date().getTime();
    try {
        syno = new Syno({
            ignoreCertificateErrors: true,
            /*rejectUnauthorized: false,*/
            host: adapter.config.host || '127.0.0.1',
            port: adapter.config.port || '5000',
            account: adapter.config.login || 'admin',
            passwd: adapter.config.password || '',
            protocol: adapter.config.https ? 'https' : 'http',
            apiVersion: adapter.config.version || '6.2.2',
            otp: 'ASE32YJSBKUOIDPB',
            debug: false
        });
        //console.warn('response[\'sid\'] = ' + response['sid'] + ' OPTIONS - ' + JSON.stringify(options));
        timeOutPoll && clearTimeout(timeOutPoll);
        queuePolling();
    } catch (e) {
        adapter.log.error('Synology Error: ' + e.message);
    }
}

let PollCmd = {
    "firstPoll": [
        {api: 'dsm', method: 'getPollingData', params: {}, ParseFunction: parseInstallingPackets},
        {api: 'dsm', method: 'getInfo', params: {}, ParseFunction: parseInfo},
        {api: 'fs', method: 'getInfo', params: {}, ParseFunction: parseInfo},
        {api: 'dl', method: 'getInfo', params: {}, ParseFunction: parseInfo},
        {api: 'as', method: 'getInfo', params: {}, ParseFunction: parseInfo},
        {api: 'vs', method: 'getInfo', params: {}, ParseFunction: parseInfo},
        //{api: 'dtv', method: 'GetInfoTuner', params: {}, ParseFunction: parseInfo},
        {api: 'ss', method: 'getInfo', params: {}, ParseFunction: parseInfo},
        {api: 'as', method: 'listRemotePlayers', params: {}, ParseFunction: parseListRemotePlayers}
    ],
    "fastPoll": [
        {api: 'dsm', method: 'getSystemUtilization', params: {}, ParseFunction: parseSystemUtilization},
        {api: 'dsm', method: 'getSystemStatus', params: {}, ParseFunction: parseSystemStatus},
        {api: 'dsm', method: 'infoSystem', params: {type: "storage", version: 1}, ParseFunction: parseInfoSystem},
        getStatusRemotePlayers,
    ],
    "slowPoll": [
        {api: 'dsm', method: 'getPollingData', params: {}, ParseFunction: parseInstallingPackets}
    ],
};

function getStatusRemotePlayers(states) {
    Object.keys(states.AudioStation.players).forEach((playerid) => {
        getStatusPlayer(playerid, (res) => {
            //console.log(res);
        });
    });
    return states;
}

function getStatusPlayer(playerid, cb) {
    adapter.log.debug('--------------------- getStatusPlayer -----------------------');
    let param = {};
    if (playerid) {
        param = {
            id: playerid,
            additional: 'song_tag,song_audio,subplayer_volume'
        };
        send('as', 'getStatusRemotePlayerStatus', param, (res) => {
            //adapter.log.error('******************* getStatusRemotePlayerStatus - ' + JSON.stringify(res));
            if (res.state === 'playing' && res.song) {
                current_player = playerid;
                states.AudioStation.players[playerid].status = 'play';
                states.AudioStation.players[playerid].state_playing = res.state;
                states.AudioStation.players[playerid].position = res.position;
                states.AudioStation.players[playerid].playlist_total = res.playlist_total;
                states.AudioStation.players[playerid].volume = res.volume;
                states.AudioStation.players[playerid].song = JSON.stringify(res.song);
                states.AudioStation.players[playerid].album = res.song.additional.song_tag.album;
                states.AudioStation.players[playerid].artist = res.song.additional.song_tag.artist;
                states.AudioStation.players[playerid].genre = res.song.additional.song_tag.genre;
                states.AudioStation.players[playerid].year = res.song.additional.song_tag.year;
                states.AudioStation.players[playerid].song_id = res.song.id;
                states.AudioStation.players[playerid].title = res.song.title;
                states.AudioStation.players[playerid].path = res.song.path;
                states.AudioStation.players[playerid].repeat = res.play_mode.repeat;
                states.AudioStation.players[playerid].shuffle = res.play_mode.shuffle;
                states.AudioStation.players[playerid].bitrate = res.song.additional.song_audio.bitrate;
                states.AudioStation.players[playerid].duration = SecToText(res.song.additional.song_audio.duration);
                states.AudioStation.players[playerid].current_duration = SecToText(res.position);
                states.AudioStation.players[playerid].current_elapsed = SecToText(res.song.additional.song_audio.duration - res.position);
                states.AudioStation.players[playerid].seek = parseInt((res.position / res.song.additional.song_audio.duration) * 100, 10);
                send('as', 'getPlayListRemotePlayer', param, (res) => {
                    let playlist = [];
                    let arr = res.songs;
                    arr.forEach((k, i) => {
                        playlist[i] = {
                            "id": arr[i].id,
                            "artist": "",
                            "album": "",
                            "bitrate": 0,
                            "title": arr[i].title,
                            "file": arr[i].path,
                            "genre": "",
                            "year": 0,
                            "len": "00:00",
                            "rating": "",
                            "cover": ""
                        }
                    });
                    states.AudioStation.players[playerid].playlist = JSON.stringify(playlist);
                });
            } else {
                states.AudioStation.players[playerid].status = 'stop';
                states.AudioStation.players[playerid].state_playing = '';
                states.AudioStation.players[playerid].position = '';
                states.AudioStation.players[playerid].playlist_total = '';
                states.AudioStation.players[playerid].volume = '';
                states.AudioStation.players[playerid].song = '';
                states.AudioStation.players[playerid].album = '';
                states.AudioStation.players[playerid].artist = '';
                states.AudioStation.players[playerid].genre = '';
                states.AudioStation.players[playerid].year = '';
                states.AudioStation.players[playerid].song_id = '';
                states.AudioStation.players[playerid].title = '';
                states.AudioStation.players[playerid].path = '';
                states.AudioStation.players[playerid].repeat = '';
                states.AudioStation.players[playerid].shuffle = '';
                states.AudioStation.players[playerid].bitrate = '';
                states.AudioStation.players[playerid].duration = '';
                states.AudioStation.players[playerid].current_duration = '';
                states.AudioStation.players[playerid].current_elapsed = '';
                states.AudioStation.players[playerid].seek = '';
                states.AudioStation.players[playerid].playlist = '';
            }
            cb && cb(res);
        });
    }
}

function parseListRemotePlayers(api, states, res) {
    states.AudioStation.info.RemotePlayers = JSON.stringify(res.players);
    res.players.forEach((player, i) => {
        states.AudioStation.players[player.id] = {'name': player.name};
    });
    return states;
}

function parseInfoSystem(api, states, res) {
    res.hdd_info.forEach((key) => {
        let diskname = key.diskno.toLowerCase().replace(' ', '_');
        states.DiskStationManager.hdd_info[diskname] = {
            'diskno': key.diskno,
            'model': key.model.replace(/\s{2,}/g, ''),
            'status': key.status,
            'temp': key.temp,
            'volume': key.volume,
            'capacity': (key.capacity / 1073741824).toFixed(2, 10)
        };
    });
    res.vol_info.forEach((key) => {
        const volname = key.name.toLowerCase();
        states.DiskStationManager.vol_info[volname] = {
            'name': key.name,
            'status': key.status,
            'total_size': (key.total_size / 1073741824).toFixed(2, 10),
            'used_size': (key.used_size / 1073741824).toFixed(2, 10),
            'used': ((key.used_size / key.total_size) * 100).toFixed(2, 10),
            'desc': key.desc
        };
    });
    return states;
}

function parseInstallingPackets(api, states, res) {
    Object.keys(res.packages).forEach((key) => {
        if (states.api[key]) {
            states.api[key]['installed'] = res.packages[key];
        }
    });
    return states;
}

function parseInfo(api, states, res) {
    if (states.api[api].installed) {
        const apiName = states.api[api].name;
        Object.keys(res).forEach((key) => {
            states[apiName].info[key] = res[key];
        });
    }
    return states;
}

function parseSystemUtilization(api, states, res) {
    states.DiskStationManager.info['cpu_load'] = parseInt(res.cpu.other_load) + parseInt(res.cpu.system_load) + parseInt(res.cpu.user_load);
    states.DiskStationManager.info['memory_usage'] = parseInt(res.memory.real_usage);
    states.DiskStationManager.info['memory_size'] = parseInt(res.memory.memory_size);
    return states;
}

function parseSystemStatus(api, states, res) {
    states.DiskStationManager.info['is_disk_wcache_crashed'] = res.is_disk_wcache_crashed;
    states.DiskStationManager.info['is_system_crashed'] = res.is_system_crashed;
    states.DiskStationManager.info['upgrade_ready'] = res.upgrade_ready;
    return states;
}

function queuePolling() {
    if (pollAllowed) {
        iteration = 0;
        isPoll = true;
        let namePolling = '';
        if (endTime - startTime > slowPollingTime) {
            startTime = new Date().getTime();
            namePolling = 'slowPoll';
        } else {
            if (firstStart) {
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

function sendPolling(namePolling, cb) {
    adapter.log.debug('-----------------------------------------------------------------------------------------------------');
    if (typeof PollCmd[namePolling][iteration] === 'function') {
        states = PollCmd[namePolling][iteration](states);
        iterator(namePolling, cb);
    } else {
        const api = PollCmd[namePolling][iteration].api;
        const method = PollCmd[namePolling][iteration].method;
        const params = PollCmd[namePolling][iteration].params;
        adapter.log.debug('Получаем информацию из массива (' + namePolling + ') api: ' + api + ' method: ' + method + ' params: ' + JSON.stringify(params));
        try {
            syno[api][method](params, (err, res) => {
                adapter.log.debug(!err && res ? 'Ответ получен, парсим:' : 'Нет ответа на команду, читаем следующую.');
                if (!err && res) {
                    states = PollCmd[namePolling][iteration].ParseFunction(api, states, res);
                } else if (err) {
                    adapter.log.error('Error - ' + err);
                }
                iterator(namePolling, cb);
                /*iteration++;
                if (iteration > PollCmd[namePolling].length - 1) {
                    iteration = 0;
                    if (namePolling === 'firstPoll') firstStart = false;
                    queueCmd && sendQueue(queueCmd);
                    pollAllowed = true;
                    adapter.log.debug('### Все данные прочитали, сохраняем полученные данные. ###');
                    isPoll = false;
                    setStates();
                    timeOutPoll = setTimeout(() => {
                        endTime = new Date().getTime();
                        queuePolling();
                    }, poll_time);
                } else {
                    sendPolling(namePolling, cb);
                }*/
            });
        } catch (e) {
            error(e);
        }
    }
}

function iterator(namePolling, cb) {
    iteration++;
    if (iteration > PollCmd[namePolling].length - 1) {
        iteration = 0;
        if (namePolling === 'firstPoll') firstStart = false;
        queueCmd && sendQueue(queueCmd);
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

function sendQueue(cmd) {
    send(cmd, (response) => {
        queueCmd = null;
        cmd.cb && cmd.cb(response);
    });
}

///////////////////* SurveillanceStation */////////////////////
function listEvents(cb) {
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
        start: 0,
        limit: 100,
        version: 1
    };
    //send('ss', 'getInfoCamera', param, function (res){
    send('ss', 'listHistoryActionRules', param, (res) => {
        if (res) {
            states.SurveillanceStation.events = JSON.stringify(res);
            adapter.log.error('****************** ' + JSON.stringify(res));
        }
        cb && cb();
    });
}

function listCameras(cb) {
    adapter.log.debug('--------------------- listCameras -----------------------');
    let param = {
        basic: true
    };
    send('ss', 'listCameras', param, (res) => {
        if (res) {
            let arr = res.cameras;
            arr.forEach((k, i) => {
                states.SurveillanceStation.cameras[arr[i].name] = {
                    host: arr[i].host,
                    id: arr[i].id,
                    port: arr[i].port,
                    model: arr[i].model,
                    status: CamStatus(arr[i].status),
                    recStatus: arr[i].recStatus,
                    snapshot_path: arr[i].snapshot_path,
                    enabled: arr[i].enabled
                }
            });
        }
        cb && cb();
    });
}

/**
 * @return {string}
 */
function CamStatus(status) {
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

function getSnapshotCamera(camid, cb) {
    adapter.log.debug('--------------------- getSnapshotCamera -----------------------');
    //let decodedImage = new Buffer(encodedImage, 'base64').toString('binary');
    //{"method":"getSnapshotCamera", "params":{"cameraId":2, "camStm": 1, "preview": true}}
    if (camid) {
        let param = {
            'cameraId': camid
        };
        send('ss', 'getSnapshotCamera', param, (res) => {
            if (res) {
            }
            cb && cb();
        });
    }
}

function listSnapShots(cb) {
    //{"auInfo":{"cms":null,"deleteByRecordId":{"data":[]},"serverAction":{"0":null,"1":null,"2":null,"3":null,"4":null,"5":null},"timestamp":1507218967,"volumeAction":null},"data":[],"recCntData":{"recCnt":{"date":{"-1":0}},"total":0},"timestamp":"1507650252","total":0}
    send('ss', 'listSnapShots', (res) => {
        if (res) {
            states.SurveillanceStation.snapshots_list = JSON.stringify(res.data);
        }
        cb && cb();
    });
}

function loadSnapShot(id, cb) {
    if (id) {
        let param = {
            id: id,
            imgSize: 2
            /*
             0: Do not append image
             1: Icon size
             2: Full size
             */
        };
        send('ss', 'loadSnapShot', param, (res) => {
            if (res) {

            }
            cb && cb();
        });
    }
}

///////////////////* DownloadStation */////////////////////////
function addDownload(url, cb) {
    adapter.log.debug('--------------------- addDownload -----------------------');
    let param = {
        type: "url",
        create_list: true,
        uri: [url],
        version: 2
    };
    adapter.getState('AudioStation.folder', (err, state) => {
        if ((err || !state)) {
        } else {
            param.destination = state.val;
        }
    });
    send('dl', 'createTask', param, (res) => {
        if (res) {
            adapter.log.error('****************** ' + JSON.stringify(res));
        }
        cb && cb();
    });
}

///////////////////* VideoStation *////////////////////////////
///////////////////* VideoStation_DTV *////////////////////////

/*************************************************************/

function send(api, method, params, cb) {
    if (typeof params == 'function') {
        cb = params;
        params = null;
    }
    try {
        syno[api][method](params, (err, data) => {
            //adapter.log.debug('---DEBUG RES DATA--- :{"api": ' + api + ', "method": ' + method + ' } \r\nRESPONSE: ' + JSON.stringify(data));
            data = data || '';
            if (!err) {
                cb && cb(data);
            } else {
                err && error(err);
            }
        });
    } catch (e) {
        adapter.log.error('--- Send Error ' + JSON.stringify(e));
    }
}

function setStates() {
    adapter.log.debug('--------------------- setStates -----------------------');
    let ids = '';
    Object.keys(states).forEach((_api) => {
        if (_api !== 'api') {
            Object.keys(states[_api]).forEach((_type) => {
                if (typeof states[_api][_type] == 'object') {
                    Object.keys(states[_api][_type]).forEach((key) => {
                        if (typeof states[_api][_type][key] == 'object') {
                            //states[_api][_type][key] = JSON.stringify(states[_api][_type][key]);
                            Object.keys(states[_api][_type][key]).forEach((key2) => {
                                //adapter.log.error('*********' + states[_api][_type][key][key2]);
                                if (!old_states[_api][_type].hasOwnProperty(key)) {
                                    old_states[_api][_type][key] = {};
                                }
                                if (states[_api][_type][key][key2] !== old_states[_api][_type][key][key2]) {
                                    old_states[_api][_type][key][key2] = states[_api][_type][key][key2];
                                    ids = _api + '.' + _type + '.' + key + '.' + key2;
                                    setObject(ids, states[_api][_type][key][key2]);
                                }
                            });
                        } else {
                            if (states[_api][_type][key] !== old_states[_api][_type][key]) {
                                old_states[_api][_type][key] = states[_api][_type][key];
                                ids = _api + '.' + _type + '.' + key;
                                setObject(ids, states[_api][_type][key]);
                            }
                        }
                    });
                } else {
                    if (states[_api][_type] !== old_states[_api][_type]) {
                        old_states[_api][_type] = states[_api][_type];
                        ids = _api + '.' + _type;
                        setObject(ids, states[_api][_type]);
                    }
                }
            });
        }
    });
}

function setObject(name, val) {
    let type = 'string';
    let role = 'state';
    adapter.log.debug('setObject ' + JSON.stringify(name));
    adapter.getObject(name, function (err, obj) {
        if ((err || !obj)) {
            adapter.setObject(name, {
                type: 'state',
                common: {
                    name: name,
                    desc: name,
                    type: type,
                    role: role
                },
                native: {}
            });
            adapter.setState(name, {val: val, ack: true});
        } else {
            adapter.getState(name, function (err, state) {
                if (!err && state !== null) {
                    if (state.val === val) {
                        //adapter.log.debug('setState ' + name + ' { oldVal: ' + state.val + ' = newVal: ' + val + ' }');
                    } else if (state.val !== val) {
                        adapter.setState(name, {val: val, ack: true});
                        adapter.log.debug('setState ' + name + ' { oldVal: ' + state.val + ' != newVal: ' + val + ' }');
                    }
                } else {
                    adapter.log.debug('setState error ' + name);
                }
            });
        }
    });
}

function error(e) {
    let code = e.code;
    let err = '';
    if (code !== 'ECONNREFUSED') {
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
    if (code === 400/* || code === 119*/ || code === 'ECONNREFUSED' || code === 'ETIMEDOUT') {
        timeOutPoll && clearTimeout(timeOutPoll);
        adapter.setState('info.connection', false, true);
        connect = false;
        timeOutPoll = setTimeout(() => {
            queuePolling()
        }, 1000);
    }
    adapter.log.error('******************************************************************************');
    adapter.log.error('***DEBUG RES ERR : code(' + code + ') ' + JSON.stringify(err));
    adapter.log.error('******************************************************************************');
}

function SecToText(sec) {
    let res;
    let m = Math.floor(sec / 60);
    let s = sec % 60;
    let h = Math.floor(m / 60);
    m = m % 60;
    if (h > 0) {
        res = pad2(h) + ":" + pad2(m) + ":" + pad2(s);
    } else {
        res = pad2(m) + ":" + pad2(s);
    }
    return res;
}

function pad2(num) {
    let s = num.toString();
    return (s.length < 2) ? "0" + s : s;
}

if (module.parent) {
    module.exports = startAdapter;
} else {
    startAdapter();
}