"use strict";

var utils = require('@iobroker/adapter-core'); // Get common adapter utils
var adapter = utils.Adapter('synology');
var Syno = require('syno');

var states = {
    'DiskStationManager':    {'info': {}, 'hdd_info': {}, 'vol_info': {}  },
    'FileStation':           {'info': {}  },
    'DownloadStation':       {'info': {}  },
    'AudioStation':          {'info': {}, 'Browser': ''  },
    'VideoStation':          {'info': {}  },
    'VideoStation_DTV':      {'info': {}  },
    'SurveillanceStation':   {'info': {}, 'cameras': {}  }
};
var old_states = {
    'DiskStationManager':    {'info': {}, 'hdd_info': {}, 'vol_info': {}  },
    'FileStation':           {'info': {}  },
    'DownloadStation':       {'info': {}  },
    'AudioStation':          {'info': {}, 'Browser': ''  },
    'VideoStation':          {'info': {}  },
    'VideoStation_DTV':      {'info': {}  },
    'SurveillanceStation':   {'info': {}, 'cameras': {}  }
};
var api = {
   'DiskStationManager':  { name: 'dsm',  polldata: [],  installed: true  },
   'FileStation':         { name: 'fs',   polldata: [],  installed: false },
   'DownloadStation':     { name: 'dl',   polldata: [],  installed: false },
   'AudioStation':        { name: 'as',   polldata: [],  installed: false },
   'VideoStation':        { name: 'vs',   polldata: [],  installed: false },
   'VideoStation_DTV':    { name: 'dt',   polldata: [],  installed: false },
   'SurveillanceStation': { name: 'ss',   polldata: [],  installed: false }
};
var poll_time = 5000, _poll, remote_players = [], connect = false;
var current_player = '';
var syno;

adapter.on('unload', function (callback) {
    try {
        adapter.log.info('cleaned everything up...');
        callback();
    } catch (e) {
        callback();
    }
});
adapter.on('objectChange', function (id, obj) {
    adapter.log.info('objectChange ' + id + ' ' + JSON.stringify(obj));
});
adapter.on('stateChange', function (id, state) {
    if (state && !state.ack){
        adapter.log.debug('stateChange ' + id + ' ' + JSON.stringify(state));
        var ids = id.split(".");
        var name = ids[ids.length - 2].toString();
        var command = ids[ids.length - 1].toString();
        var val = state.val;
        if(command == 'reboot'){
            name = 'DiskStationManager';
            val = 'rebootSystem';
        }
        if(command == 'shutdown'){
            name = 'DiskStationManager';
            val = 'shutdownSystem';
        }

        if(command == 'Browser'){  /*  /AS  */
            Browser(val);
        } else if (command == 'play_folder'){
            var a = val.split(',');
            PlayFolder(a[0], a[1]);
        } else if (command == 'play_track'){
                var s = val.split(',');
                PlayTrack(s[0], s[1]);
        } else if (command == 'stop' || command == 'next' || command == 'prev'){
            PlayControl(command);
        }  else if (command == 'selected_player'){
            current_player = val;  /*  /AS  */
        }  else if (command == 'volume'){
            PlayControl('set_volume', val);  /*  /AS  */
        }  else if (command == 'seek'){
            PlayControl(command, val);  /*  /AS  */
        }  else if (command == 'getSnapshotCamera'){
            getSnapshotCamera(val);
        }  else if (command == 'add_url_download'){
            addDownload(val);
        } else {
            if (api[name]){
                if (api[name].installed){
                    //{"method":"getStatusRemotePlayer", "params":{"id": "uuid:90290a7d-f6cf-f783-84d9-30f315a97db9"}}
                    var json, param;
                    try {
                        json = JSON.parse(val);
                        if (!json.method) {
                            throw new SyntaxError("Error command");
                        }
                        else {
                            val = json.method;
                            if(typeof json.params === 'object'){
                                param = json.params;
                            } else {
                                param = {};
                            }
                            send(api[name]['name'], val, param, function (res){
                                if (res){
                                    var id = name + '.sendMethod';
                                    adapter.setState(id, {val: JSON.stringify(res), ack: true});
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
});
adapter.on('message', function (obj) {
    if (typeof obj == 'object' && obj.message) {
        if (obj.command == 'send') {
            console.log('send command');
            if (obj.callback) adapter.sendTo(obj.from, obj.command, 'Message received', obj.callback);
        }
    }
});
adapter.on('ready', function () {
    adapter.subscribeStates('*');
    syno = new Syno({
        ignoreCertificateErrors: true,
        /*rejectUnauthorized: false,*/
        host: adapter.config.host ? adapter.config.host: '127.0.0.1',
        port: adapter.config.port ? adapter.config.port: '5000',
        account: adapter.config.login ? adapter.config.login: 'admin',
        passwd: adapter.config.password ? adapter.config.password: '',
        protocol: adapter.config.https ? 'https' : 'http',
        apiVersion: adapter.config.version ? adapter.config.version: '6.0.2'
    });
    poll_time = adapter.config.polling ? adapter.config.polling: 5000;
    main();
});

function main() {
    clearTimeout(_poll);
    getInstallingPackets(function (){
        adapter.setState('info.connection', true, true);
        connect = true;
        Object.keys(api).forEach(function(k) {
            if(api[k].installed){
                getInfo(k);
            }
        });
        if(api.SurveillanceStation.installed){
            listCameras();
        }
        polling();
    });
}
function polling(){
    clearTimeout(_poll);
    _poll = setTimeout(function (){
        getDSMInfo(function (){
            if(!connect){
                adapter.setState('info.connection', true, true);
                connect = true;
            }
            if(api.AudioStation.installed){ //камент для теста
                getAudio(function (){
                    if(current_player){
                        getStatusRemotePlayer(current_player);
                    }
                });
            }
            if(api.SurveillanceStation.installed){
                //listEvents(); //TODO надо доделать камеры
            }
            setStates();
            polling();
        });
    }, poll_time);
}
/////////////////* DiskStationManager */////////////////////////
function getDSMInfo(cb){
    send('dsm', 'getInfo', function (res){
        Object.keys(res).forEach(function(k) {
            states.DiskStationManager.info[k] = res[k];
        });
        send('dsm', 'getSystemUtilization', function (res){
            //states.DiskStationManager.resources = res;
            if(res){
                states.DiskStationManager.info['cpu_load'] = parseInt(res.cpu.other_load) + parseInt(res.cpu.system_load) + parseInt(res.cpu.user_load);
                states.DiskStationManager.info['memory_usage'] = parseInt(res.memory.real_usage);
                states.DiskStationManager.info['memory_size'] = parseInt(res.memory.memory_size);
            }
            send('dsm', 'getSystemStatus', function (res){
                //states.DiskStationManager.system_status = res;
                if(res){
                    states.DiskStationManager.info['is_disk_wcache_crashed'] = res.is_disk_wcache_crashed;
                    states.DiskStationManager.info['is_system_crashed'] = res.is_system_crashed;
                    states.DiskStationManager.info['upgrade_ready'] = res.upgrade_ready;
                }
                var param = {
                    type: "storage",
                    version: 1
                };
                send('dsm', 'infoSystem', param, function (res){
                    if(res){
                        res.hdd_info.forEach(function(k, i) {
                            var diskname = k.diskno.toLowerCase().replace(' ', '_');
                            states.DiskStationManager.hdd_info[diskname] = {
                                'diskno'  : k.diskno,
                                'model'   : k.model.replace(/\s{2,}/g, ''),
                                'status'  : k.status,
                                'temp'    : k.temp,
                                'volume'  : k.volume,
                                'capacity': (k.capacity / 1073741824).toFixed(2, 10)
                            };
                        });
                        res.vol_info.forEach(function(k, i) {
                            var volname = k.name.toLowerCase();
                            states.DiskStationManager.vol_info[volname] = {
                                'name'       : k.name,
                                'status'     : k.status,
                                'total_size' : (k.total_size / 1073741824).toFixed(2, 10),
                                'used_size'  : (k.used_size / 1073741824).toFixed(2, 10),
                                'used'       : ((k.used_size / k.total_size) * 100).toFixed(2, 10),
                                'desc'       : k.desc
                            };
                        });
                    }
                    if(cb){cb();}
                });
            });
        });
    });
}

///////////////////* FileStation */////////////////////////////

///////////////////* AudioStation *////////////////////////////
function getAudio(cb){
    send('as', 'listRemotePlayers', function (res){
        if(res){
            //adapter.log.error('****************** ' + JSON.stringify(res));
            states.AudioStation.info.RemotePlayers = JSON.stringify(res.players);
            res.players.forEach(function (k, i){
                remote_players[i] = k.id;
            });
            adapter.getState('AudioStation.selected_player', function (err, state){
                if ((err || !state)){
                    current_player = '';
                } else {
                    if(~remote_players.indexOf(state.val)){
                        current_player = state.val;
                        getStatusRemotePlayer(current_player);
                    } else {
                        adapter.log.debug('getAudio id плеера (' + state.val + ')не найден в списке доступных:' + JSON.stringify(remote_players));
                    }
                }
            });
        }
        if(cb){cb();}
    });
}
function Browser(id, cb){
    var param = {};
    if(id && id !== '/'){
        param = {id: id};
    }
    send('as', 'listFolders', param, function (res){
        var arr = [];
        res.items.forEach(function(k, i) {
            var filetype = 'file';
            if(res.items[i].type == 'folder'){
                filetype = 'directory';
            }
            arr.push({
                "id":       res.items[i].id,
                "file":     res.items[i].path,
                "filetype": filetype,
                "title":    res.items[i].title
            });
        });
        states.AudioStation.Browser = JSON.stringify(arr);
        if(cb){cb();}
    });
}
function PlayControl(cmd, val, cb){
    var id = current_player;
    var param = {};
    if(id){
        param = {
            id: id,
            action: cmd
        };
        if(cmd === 'set_volume'){
            if(val < 0){val = 0;}
            if(val > 100){val = 100;}
            param.value = val;
        }
        if(cmd === 'seek'){
            param.value = (states.AudioStation.duration / 100) * val;
        }
        adapter.log.debug('PlayControl cmd - ' + cmd + '. param - ' + JSON.stringify(param));
        send('as', 'controlRemotePlayer', param, function (res){
            //current_player = '';
            if(cb){cb();}
        });
    }
}
function PlayFolder(id, folder, limit, cb){
    if(!id){
        id = current_player;
    }
    var param = {};
    if(id){ //uuid:2eff7682-632d-6283-c2cc-29e985e5955c
        param = {
            id: id,
            library:'shared',
            offset:0,
            limit:1,
            play: true,
            containers_json:[{"type":"folder", "id": folder, "recursive":true, "sort_by":"title", "sort_direction":"ASC"}]
        };
        send('as', 'updatePlayListRemotePlayer', param, function (res){
        });
        param = {
            id: id,
            action: 'play'
        };
        send('as', 'controlRemotePlayer', param, function (res){
        });

    }
}
function PlayTrack(id, track, cb){
    if(!id){
        id = current_player;
    }
    var param = {};
    if(id){ //uuid:bab0037b-3c03-7bb9-4d0a-7b093cb9358c
        param = {
            id: id,
            library:'shared',
            offset:0,
            limit:1,
            play:true,
            songs: track,
            containers_json:[]
        };
        send('as', 'updatePlayListRemotePlayer', param, function (res){
        });
        param = {
            id: id,
            action: 'play'
        };
        send('as', 'controlRemotePlayer', param, function (res){
        });
    }
}
function getStatusRemotePlayer(id, cb){
    var param = {};
    if(id){
        param = {
            id: id,
            additional:'song_tag,song_audio,subplayer_volume'
        };
        send('as', 'getStatusRemotePlayerStatus', param, function (res){
            //states.AudioStation.StatusRemotePlayer = JSON.stringify(res);
            //adapter.log.error('******************* getStatusRemotePlayerStatus - ' + JSON.stringify(res));
            states.AudioStation.state_playing = res.state;
            states.AudioStation.position = res.position;
            states.AudioStation.playlist_total = res.playlist_total;
            states.AudioStation.volume = res.volume;
            states.AudioStation.song = JSON.stringify(res.song);
            states.AudioStation.duration = SecToText(res.song.additional.song_audio.duration);
            states.AudioStation.current_duration = SecToText(res.position);
            states.AudioStation.current_elapsed = SecToText(res.song.additional.song_audio.duration - res.position);
            states.AudioStation.seek = parseInt((res.position / res.song.additional.song_audio.duration) * 100 , 10);
            if(res.state == 'playing' && res.song){
                send('as', 'getPlayListRemotePlayer', param, function (res){
                    var playlist = [];
                    var arr = res.songs;
                    arr.forEach(function (k, i){
                        playlist[i] = {
                            "id": arr[i].id,
                            "artist": "",
                            "album": "",
                            "bitrate":0,
                            "title": arr[i].title,
                            "file": arr[i].path,
                            "genre": "",
                            "year": 0,
                            "len": "00:00",
                            "rating": "",
                            "cover": ""
                        }
                    });
                    states.AudioStation.playlist = JSON.stringify(playlist);
                });
            }
            if(cb){cb();}
        });
    }
}
///////////////////* SurveillanceStation */////////////////////
function listEvents(cb){
    //{"events":[],"offset":0,"timestamp":"1507648068","total":0}

    var param = {
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
    };
    var param = {
        start: 0,
        limit: 100,
        version:1
    };
    //send('ss', 'getInfoCamera', param, function (res){
    send('ss', 'listHistoryActionRules', param, function (res){
        if(res){
            states.SurveillanceStation.events = JSON.stringify(res);
            adapter.log.error('****************** ' + JSON.stringify(res));
        }
        if(cb){cb();}
    });
}
function listCameras(cb){
    var param = {
        basic:true
    };
    send('ss', 'listCameras', param, function (res){
        if(res){
            var arr = res.cameras;
            arr.forEach(function (k, i){
                states.SurveillanceStation.cameras[arr[i].name] = {
                    host: arr[i].host,
                    id:   arr[i].id,
                    port: arr[i].port,
                    model: arr[i].model,
                    status: CamStatus(arr[i].status),
                    recStatus: arr[i].recStatus,
                    snapshot_path: arr[i].snapshot_path,
                    enabled: arr[i].enabled
                }
            });
        }
        if(cb){cb();}
    });
}
function CamStatus(status){
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
    //var decodedImage = new Buffer(encodedImage, 'base64').toString('binary');
    //{"method":"getSnapshotCamera", "params":{"cameraId":2, "camStm": 1, "preview": true}}
    if(camid){
        var param = {
            'cameraId': camid
        };
        send('ss', 'getSnapshotCamera', param, function (res){
                if (res){
                }
                if (cb){cb();}
            });
    }
}
function listSnapShots(cb){
    //{"auInfo":{"cms":null,"deleteByRecordId":{"data":[]},"serverAction":{"0":null,"1":null,"2":null,"3":null,"4":null,"5":null},"timestamp":1507218967,"volumeAction":null},"data":[],"recCntData":{"recCnt":{"date":{"-1":0}},"total":0},"timestamp":"1507650252","total":0}
    send('ss', 'listSnapShots', function (res){
        if(res){
            states.SurveillanceStation.snapshots_list = JSON.stringify(res.data);
        }
        if(cb){cb();}
    });
}
function loadSnapShot(id, cb){
    if(id){
        var param = {
            id: id,
            imgSize: 2
            /*
             0: Do not append image
             1: Icon size
             2: Full size
             */
        };
        send('ss', 'loadSnapShot', param, function (res){
                if (res){

                }
                if (cb){cb();}
        });
    }
}
///////////////////* DownloadStation */////////////////////////
function addDownload(url, cb){
    var param = {
        type: "url",
        create_list: true,
        uri: [url],
        version: 2
    };
    adapter.getState('AudioStation.folder', function (err, state){
        if ((err || !state)){
        } else {
            param.destination = state.val;
        }
    });
    send('dl', 'createTask', param, function (res){
        if(res){
            adapter.log.error('****************** ' + JSON.stringify(res));
        }
        if(cb){cb();}
    });
}

///////////////////* VideoStation *////////////////////////////
///////////////////* VideoStation_DTV *////////////////////////

/*************************************************************/
function getInstallingPackets(cb){
    send('dsm', 'getPollingData', function (res){
        if(res){
            Object.keys(res.packages).forEach(
                function (k){
                    if (api[k]){
                        api[k]['installed'] = res.packages[k];
                    }
                });
        } else {
            error({code:999});
        }
        if(cb){cb();}
    });
}
function getInfo(key){
    send(api[key].name, 'getInfo', function (res){
        if(res){
            Object.keys(res).forEach(
                function (k){
                    states[key].info[k] = res[k];
                });
        } else {
            error({code:998});
        }
    });
}
function send(api, method, params, cb){
    if(typeof params == 'function'){
        cb = params;
        params = null;
    }
    syno[api][method](params, function(err, data) {
        if(!data){
            data = '';
        }
        if(!err){
            adapter.log.debug('---DEBUG RES DATA--- :{"api": ' + api + ', "method": ' + method + ' } \r\nRESPONSE: ' + JSON.stringify(data));
        } else{
            adapter.log.debug('---DEBUG RES DATA--- :{"api": ' + api + ', "method": ' + method + ' } \r\nRESPONSE: ' + JSON.stringify(data));
            error(err);
        }
        if(cb){
            cb(data);
        }
    });
}
function setStates(){
    adapter.log.debug('setStates');
    var ids = '';
    Object.keys(states).forEach(function(_api) {
        Object.keys(states[_api]).forEach(function(_type) {
            if(typeof states[_api][_type] == 'object'){
                Object.keys(states[_api][_type]).forEach(function(key) {
                    if(typeof states[_api][_type][key] == 'object'){
                        //states[_api][_type][key] = JSON.stringify(states[_api][_type][key]);
                        Object.keys(states[_api][_type][key]).forEach(function(key2) {
                            //adapter.log.error('*********' + states[_api][_type][key][key2]);
                            if(!old_states[_api][_type].hasOwnProperty(key)){
                                old_states[_api][_type][key] = {};
                            }
                            if (states[_api][_type][key][key2] !== old_states[_api][_type][key][key2]){
                                old_states[_api][_type][key][key2] = states[_api][_type][key][key2];
                                ids = _api + '.' + _type + '.' + key + '.'+ key2;
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
    });
}
function setObject(name, val){
    var type = 'string';
    var role = 'state';
    adapter.log.debug('setObject ' + JSON.stringify(name));
    adapter.getState(name, function (err, state){
        if ((err || !state)){
            adapter.setObject(name, {
                type:   'state',
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
            adapter.setState(name, {val: val, ack: true});
        }
    });
}

function error(e){
    var code = e.code;
    var err;
    if(code !== 'ECONNREFUSED'){
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
    if(code == 400 || code == 119 || code == 'ECONNREFUSED'){
        clearTimeout(_poll);
        adapter.setState('info.connection', false, true);
        connect = false;
        setTimeout(function (){
                polling();
        }, poll_time);
    }
    if(!err){
        err = '';
    }
    adapter.log.debug('***DEBUG RES ERR : code(' + code + ') ' + JSON.stringify(err));
}

function SecToText(sec){
    var res;
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    var h = Math.floor(m / 60);
    m = m % 60;
    if (h > 0){
        res = pad2(h) + ":" + pad2(m) + ":" + pad2(s);
    } else {
        res = pad2(m) + ":" + pad2(s);
    }
    return res;
}
function pad2(num) {
    var s = num.toString();
    return (s.length < 2)? "0" + s : s;
}
