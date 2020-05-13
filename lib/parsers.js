'use strict';
const EventEmitter = require('events');
const event = new EventEmitter();
const moment = require('moment');
module.exports = event;

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

module.exports.test = (api, states, res) => {
    event.emit('debug', 'test - Response: ' + JSON.stringify(res));
    states.SurveillanceStation.cameras['Test2'].analyticsType = res.cameras[0].analyticsType;
    states.SurveillanceStation.cameras['Test2'].advContTrigEvt = res.cameras[0].detailInfo.advContTrigEvt;
    states.SurveillanceStation.cameras['Test2'].advLiveTrigEvt = res.cameras[0].detailInfo.advLiveTrigEvt;
    return states;
    //{api: 'ss', method: 'getInfoCamera', params: {basic: true, cameraIds: '2', eventDetection: true, privCamType: 3, camAppInfo: true, version: 8}, ParseFunction: parse.dIStsPollIngCameraEvent},
    //{api: 'ss', method: 'motionEnumCameraEvent', params: {camId: 2}, ParseFunction: parse.dIStsPollIngCameraEvent},
    //{api: 'ss', method: 'listEvents', params: {locked: 0, reason: 2, limit: 1, cameraIds: '2'}, ParseFunction: parse.dIStsPollIngCameraEvent},
    //{api: 'ss', method: 'enumAlert', params: {camIdList: '2', typeList: '0,1,2,3,4,5,6,7', lock: '0' }, ParseFunction: parse.dIStsPollIngCameraEvent},
    //{api: 'ss', method: 'listLogs', params: {cameraIds: "2"}, ParseFunction: parse.dIStsPollIngCameraEvent}, //События
};

////////////////////* SurveillanceStation */////////////////////
module.exports.listCameras = (api, states, res) => {
    event.emit('debug', 'listCameras - Response: ' + JSON.stringify(res));
    let arr = res.cameras;
    arr.forEach((k, i) => {
        if (arr[i].name){
            states.SurveillanceStation.cameras[arr[i].name] = { //for version 9 newName
                host:       arr[i].host || arr[i].ip,
                id:         arr[i].id,
                port:       arr[i].port,
                model:      arr[i].model,
                vendor:     arr[i].vendor,
                videoCodec: stateSS.videoCodec[arr[i].videoCodec],
                status:     stateSS.camStatus[arr[i].status],
                recStatus:  stateSS.recStatus[arr[i].recStatus],
                enabled:    arr[i].enabled
            }
        }
    });
    return states;
};
module.exports.LiveViewPathCamera = (states, res) => {
    event.emit('debug', 'LiveViewPathCamera - Response: ' + JSON.stringify(res));
    res.forEach((obj) => {
        const nameCam = getNameCams(states, obj.id);
        states.SurveillanceStation.cameras[nameCam]['linkMjpegHttpPath'] = obj.mjpegHttpPath;
        states.SurveillanceStation.cameras[nameCam]['linkMulticstPath'] = obj.multicstPath;
        states.SurveillanceStation.cameras[nameCam]['linkMxpegHttpPath'] = obj.mxpegHttpPath;
        states.SurveillanceStation.cameras[nameCam]['linkRtspOverHttpPath'] = obj.rtspOverHttpPath;
        states.SurveillanceStation.cameras[nameCam]['linkRtspPath'] = obj.rtspPath;
    });
    return states;
};
module.exports.InfoHomeMode = (api, states, res) => {
    event.emit('debug', 'InfoHomeMode - Response: ' + JSON.stringify(res));
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
    return states;
};

//////////////////////* AudioStation *//////////////////////////
module.exports.ListRemotePlayers = (api, states, res) => {
    event.emit('debug', 'ListRemotePlayers - Response: ' + JSON.stringify(res));
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
    return states;
};
module.exports.RemotePlayerStatus = (playerid, states, res) => {
    event.emit('debug', 'RemotePlayerStatus - Response: ' + JSON.stringify(res));
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
        event.emit('debug', 'RemotePlayerStatus - Error: ' + JSON.stringify(e));
    }
    return states;
};
module.exports.PlayListRemotePlayer = (playerid, states, res) => {
    event.emit('debug', 'PlayListRemotePlayer - Response: ' + JSON.stringify(res));
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
    return states;
};
module.exports.listRadios = (api, states, res) => {
    event.emit('debug', 'listRadios - Response: ' + JSON.stringify(res));
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
            event.emit('debug', 'listRadios - Error: ' + JSON.stringify(res));
        }
    }
    return states;
};

////////////////////* DownloadStation */////////////////////////
module.exports.getConfigSchedule = (api, states, res) => {
    event.emit('debug', 'getConfigSchedule - Response: ' + JSON.stringify(res));
    if (res && !res.message){
        states.DownloadStation['shedule_emule_enabled'] = res.emule_enabled;
        states.DownloadStation['shedule_enabled'] = res.enabled;
    }
    return states;
};
module.exports.listTasks = (api, states, res) => {
    event.emit('debug', 'listTasks - Response: ' + JSON.stringify(res));
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
    return states;
};

////////////////////////* dsm */////////////////////////////////
module.exports.InfoSystem = (api, states, res) => {
    event.emit('debug', 'InfoSystem - Response: ' + JSON.stringify(res));
    try {
        if (res && res.hdd_info){
            res.hdd_info.forEach((key) => {
                let diskname = key.diskno.toLowerCase().replace(' ', '_');
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
    } catch (e) {

    }
    return states;
};
module.exports.InstallingPackets = (api, states, res) => {
    event.emit('debug', 'InstallingPackets - Response: ' + JSON.stringify(res));
    if (res && res.packages){
        if (!Array.isArray(res.packages)){
            for(let fullname in res.packages){ // for getPollingData
                if (!res.packages.hasOwnProperty(fullname)) continue;
                for(let name in states.api){
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
    return states;
};
module.exports.Info = (api, states, res) => {
    event.emit('debug', 'Info - Response: ' + JSON.stringify(res));
    try {
        if (states.api[api].installed){
            const apiName = states.api[api].name;
            if (apiName !== 'SurveillanceStation'){
                Object.keys(res).forEach((key) => {
                    states[apiName].info[key] = res[key];
                });
            } else {
                states = parseSSInfo(states, res);
            }
        }
    } catch (e) {

    }
    return states;
};
module.exports.TempInfo = (api, states, res) => {
    event.emit('debug', 'TempInfo - Response: ' + JSON.stringify(res));
    try {
        states.DiskStationManager.info.temperature = res.temperature;
        states.DiskStationManager.info.temperature_warn = res.temperature_warn;
        states.DiskStationManager.info.time = res.time;
    } catch (e) {

    }
    return states;
};
module.exports.SystemUtilization = (api, states, res) => {
    event.emit('debug', 'SystemUtilization - Response: ' + JSON.stringify(res));
    try {
        if (res && res.cpu){
            states.DiskStationManager.info['cpu_load'] = /*parseInt(res.cpu.other_load) + parseInt(res.cpu.system_load) + */parseInt(res.cpu.user_load);
            states.DiskStationManager.info['memory_usage'] = parseInt(res.memory.real_usage);
            states.DiskStationManager.info['memory_size'] = parseInt(res.memory.memory_size);
        }
    } catch (e) {

    }
    return states;
};
module.exports.SystemStatus = (api, states, res) => {
    event.emit('debug', 'SystemStatus - Response: ' + JSON.stringify(res));
    try {
        states.DiskStationManager.info['is_disk_wcache_crashed'] = res.is_disk_wcache_crashed;
        states.DiskStationManager.info['is_system_crashed'] = res.is_system_crashed;
        states.DiskStationManager.info['upgrade_ready'] = res.upgrade_ready;
    } catch (e) {

    }
    return states;
};

////////////////////////* fs Sharing */////////////////////////////////
module.exports.parseListSharings = (api, states, res) => {
    event.emit('debug', 'listSharing - Response: ' + JSON.stringify(res));
    let arr = res.links;
    let temp_array = []
    arr.forEach((k, i) => {
        if (arr[i].id){
            //states.FileStation.sharing.list = JSON.stringify(arr[i]
            temp_array[i] = { //for version 9 newName
                'name':                 arr[i].name,
                'date_available':       arr[i].date_available,
                'date_expired':         arr[i].date_expired,
                'expire_times':       arr[i].expire_times,
                'enable_upload':       arr[i].enable_upload,
                'has_password':       arr[i].has_password,
                'id':      arr[i].id,
                'isFolder':     arr[i].isFolder,
                'link_owner': arr[i].link_owner,
                'limit_size': arr[i].limit_size,
                'path':     arr[i].path,
                'qrcode':     arr[i].qrcode,
                'status':  arr[i].status,
                'url':    arr[i].url,
                'request_info':    arr[i].request_info,
                'request_name':    arr[i].request_name
            }
        }
    });
    states.FileStation.sharing['list'] = JSON.stringify(temp_array)
    return states;
}

module.exports.parseCreateSharings = (states, res) => {
    event.emit('debug', 'CreateSharing - Response: ' + JSON.stringify(res));
    let arr = res.links;
    states.FileStation.sharing['last_url'] = JSON.stringify(arr[0].url)
    states.FileStation.sharing['last_qrcode'] = JSON.stringify(arr[0].qrcode)
    return states;
}

function parseSSInfo(states, res){
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
    return states;
}

const getNameCams = (states, id) => {
    for (let nameCam in states.SurveillanceStation.cameras) {
        if (!states.SurveillanceStation.cameras.hasOwnProperty(nameCam)) continue;
        if (states.SurveillanceStation.cameras[nameCam].id === id){
            return nameCam;
        }
    }
};
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
