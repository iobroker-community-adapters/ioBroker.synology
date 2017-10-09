"use strict";

var utils =    require(__dirname + '/lib/utils'); // Get common adapter utils
var adapter = utils.adapter('synology');
var Syno = require('syno');

var states = {
    'DiskStationManager':    {'info': {}  },
    'FileStation':           {'info': {}  },
    'DownloadStation':       {'info': {}  },
    'AudioStation':          {'info': {}, 'Browser': ''  },
    'VideoStation':          {'info': {}  },
    'VideoStation_DTV':      {'info': {}  },
    'SurveillanceStation':   {'info': {}  }
};
var old_states = {
    'DiskStationManager':    {'info': {}  },
    'FileStation':           {'info': {}  },
    'DownloadStation':       {'info': {}  },
    'AudioStation':          {'info': {}, 'Browser': ''  },
    'VideoStation':          {'info': {}  },
    'VideoStation_DTV':      {'info': {}  },
    'SurveillanceStation':   {'info': {}  }
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
var /*params,*/ poll_time = 5000, _poll;
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
        } else if (command == 'stop'){
            Playstop(val);  /*  /AS  */
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
        host: adapter.config.host ? adapter.config.host: '192.168.1.19',
        port: adapter.config.port ? adapter.config.port: '5000',
        account: adapter.config.login ? adapter.config.login: 'admin2',
        passwd: adapter.config.password ? adapter.config.password: 'qwerty',
        protocol: adapter.config.https ? 'https' : 'http',
        apiVersion: adapter.config.version ? adapter.config.version: '6.0.2'
    });
    main();
});

function main() {
    clearTimeout(_poll);
    getInstallingPackets(function (){
        adapter.setState('info.connection', true, true);
        Object.keys(api).forEach(function(k) {
            if(api[k].installed){
                getInfo(k);
            }
        });
        polling();
    });
}

/////////////////* DiskStationManager */////////////////////////
function getDSMInfo(cb){
    send('dsm', 'getInfo', function (res){
        Object.keys(res).forEach(function(k) {
            states.DiskStationManager.info[k] = res[k];
        });
        send('dsm', 'getSystemUtilization', function (res){
            //states.DiskStationManager.resources = res;
            states.DiskStationManager.info['cpu_load'] = parseInt(res.cpu.other_load) + parseInt(res.cpu.system_load) + parseInt(res.cpu.user_load);
            states.DiskStationManager.info['memory_usage'] = parseInt(res.memory.real_usage);
            states.DiskStationManager.info['memory_size'] = parseInt(res.memory.memory_size);
            send('dsm', 'getSystemStatus', function (res){
                //states.DiskStationManager.system_status = res;
                states.DiskStationManager.info['is_disk_wcache_crashed'] = res.is_disk_wcache_crashed;
                states.DiskStationManager.info['is_system_crashed'] = res.is_system_crashed;
                states.DiskStationManager.info['upgrade_ready'] = res.upgrade_ready;
                if(cb){cb();}
            });
        });
    });
}

///////////////////* FileStation */////////////////////////////

///////////////////* AudioStation *////////////////////////////
var current_player = '';
function getAudio(cb){
    send('as', 'listRemotePlayers', function (res){
        states.AudioStation.info.RemotePlayers = JSON.stringify(res.players);
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
function Playstop(id){
    if (!id){
        id = current_player;
    }
    var param = {};
    if(id){
        param = {
            id: id, //uuid:3ab2b166-fcbe-4761-9b48-cb60beee73ca
            action: 'stop'
        };
        send('as', 'controlRemotePlayer', param, function (res){
            current_player = '';
            if(cb){cb();}
        });
    }
}
function PlayFolder(id, folder, limit, cb){
    current_player = id;
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
    current_player = id;
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
            id: id
        };
        send('as', 'getStatusRemotePlayerStatus', param, function (res){
            //states.AudioStation.StatusRemotePlayer = JSON.stringify(res);
            states.AudioStation.info.state_playing = res.state;
            states.AudioStation.info.position = res.position;
            states.AudioStation.info.playlist_total = res.playlist_total;
            states.AudioStation.info.volume = res.volume;
            states.AudioStation.info.song = JSON.stringify(res.song);
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
                    states.AudioStation.info.playlist = JSON.stringify(playlist);
                });
            } else {
                current_player = '';
            }
            if(cb){cb();}
        });
    }
}

///////////////////* DownloadStation */////////////////////////

///////////////////* VideoStation *////////////////////////////

///////////////////* VideoStation_DTV *////////////////////////

///////////////////* SurveillanceStation */////////////////////


/*************************************************************/
function polling(){
    clearTimeout(_poll);
    _poll = setTimeout(function (){
        getDSMInfo(function (){
            getAudio(function (){
                polling();
                setStates();
            });
            if(api.AudioStation.installed){
                if(current_player){
                    getStatusRemotePlayer(current_player);
                }
            }
        });
    }, poll_time);
}
function getInstallingPackets(cb){
    send('dsm', 'getPollingData', function (res){
        Object.keys(res.packages).forEach(function(k) {
            if(api[k]){
                api[k]['installed'] = res.packages[k];
            }
        });
        if(cb){cb();}
    });
}
function getInfo(key){
    send(api[key].name, 'getInfo', function (res){
        Object.keys(res).forEach(function(k) {
            states[key].info[k] = res[k];
        });
    });
}
function send(api, method, params, cb){
    if(typeof params == 'function'){
        cb = params;
        params = null;
    }
    syno[api][method](params, function(err, data) {
        if(!err){
            adapter.log.debug('---DEBUG RES DATA--- :{"api": ' + api + ', "method": ' + method + ' } \r\nRESPONSE: ' + JSON.stringify(data));
        } else{
            adapter.log.debug('---DEBUG RES DATA--- :{"api": ' + api + ', "method": ' + method + ' } \r\nRESPONSE: ' + JSON.stringify(data));
            error(err)
        }
        if(cb && !err){
            cb(data);
        }
    });
}
function setStates(){
    var ids = '';
    Object.keys(states).forEach(function(_api) {
        Object.keys(states[_api]).forEach(function(_type) {
            if(typeof states[_api][_type] == 'object'){
                Object.keys(states[_api][_type]).forEach(function(key) {
                    if(typeof states[_api][_type][key] == 'object'){
                        states[_api][_type][key] = JSON.stringify(states[_api][_type][key]);
                    }
                    if (states[_api][_type][key] !== old_states[_api][_type][key]){
                        old_states[_api][_type][key] = states[_api][_type][key];
                        ids = _api + '.' + _type + '.' + key;
                        setObject(ids, states[_api][_type][key]);
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

function error(err){
    var code = err.code;
        switch (code) {
            case 100:
                err = '100';
            case 101:
                err = 'No parameter of API, method or version';
            case 102:
                err = 'The requested API does not exist';
            case 103:
                err = 'The requested method does not exist';
            case 104:
                err = 'The requested version does not support the functionality';
            case 105:
                err = 'The logged in session does not have permission';
            case 106:
                err = 'Session timeout';
            case 107:
                err = 'Session interrupted by duplicate login';
            case 119:
                err = '119';
            case 400:
                err = 'Error connection';
            case 450:
                err = '450';
            case 500:
                err = '500'; //controlRemotePlayer
            /*default:
                return 'Unknown error';*/
        }
    if(code == 400 || code == 119){
        clearTimeout(_poll);
        adapter.setState('info.connection', false, true);
        setTimeout(function (){
                polling();
        }, poll_time);
    }
    adapter.log.error('***DEBUG RES ERR : code(' + code + ') ' + JSON.stringify(err));
}