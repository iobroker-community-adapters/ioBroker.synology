'use strict';
const EventEmitter = require('events');
const event = new EventEmitter();
const utils = require('../lib/utils.js');
module.exports = event;

module.exports.ListRemotePlayers = (api, states, res) => {
    states.AudioStation.info.RemotePlayers = JSON.stringify(res.players);
    event.emit('debug', 'ListRemotePlayers - Response: ' + JSON.stringify(res));
    res.players.forEach((player, i) => {
        states.AudioStation.players[player.id] = {'name': player.name};
    });
    return states;
};

module.exports.RemotePlayerStatus = (playerid, states, res) => {
    event.emit('debug', 'RemotePlayerStatus - Response: ' + JSON.stringify(res));
    states.AudioStation.players[playerid].status = 'play';
    states.AudioStation.players[playerid].state_playing = res.state;
    //states.AudioStation.players[playerid].position = res.position;
    states.AudioStation.players[playerid].playlist_total = res.playlist_total;
    states.AudioStation.players[playerid].volume = res.volume;
    //states.AudioStation.players[playerid].song = JSON.stringify(res.song);
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
    createControlStatesForPlayer(playerid, states);
    return states;
};

function createControlStatesForPlayer(playerid, states){
    states.AudioStation.players[playerid].stop = '';
    states.AudioStation.players[playerid].prev = '';
    states.AudioStation.players[playerid].next = '';
}

module.exports.PlayListRemotePlayer = (playerid, states, res) => {
    let playlist = [];
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
    states.AudioStation.players[playerid].playlist = JSON.stringify(playlist);
    return states;
};

module.exports.InfoSystem = (api, states, res) => {
    event.emit('debug', 'InfoSystem - Response: ' + JSON.stringify(res));
    res.hdd_info.forEach((key) => {
        let diskname = key.diskno.toLowerCase().replace(' ', '_');
        states.DiskStationManager.hdd_info[diskname] = {
            'diskno':   key.diskno,
            'model':    key.model.replace(/\s{2,}/g, ''),
            'status':   key.status,
            'temp':     key.temp,
            'volume':   key.volume,
            'capacity': (key.capacity / 1073741824).toFixed(2, 10)
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
    return states;
};

module.exports.InstallingPackets = (api, states, res) => {
    event.emit('debug', 'InstallingPackets - Response: ' + JSON.stringify(res));
    Object.keys(res.packages).forEach((fullname) => {
        Object.keys(states.api).forEach((name) => {
            if (states.api[name].name === fullname){
                states.api[name]['installed'] = res.packages[fullname];
            }
        });
    });
    return states;
};

module.exports.Info = (api, states, res) => {
    event.emit('debug', 'Info - Response: ' + JSON.stringify(res));
    if (states.api[api].installed){
        const apiName = states.api[api].name;
        Object.keys(res).forEach((key) => {
            states[apiName].info[key] = res[key];
        });
    }
    return states;
};

module.exports.SystemUtilization = (api, states, res) => {
    event.emit('debug', 'SystemUtilization - Response: ' + JSON.stringify(res));
    states.DiskStationManager.info['cpu_load'] = parseInt(res.cpu.other_load) + parseInt(res.cpu.system_load) + parseInt(res.cpu.user_load);
    states.DiskStationManager.info['memory_usage'] = parseInt(res.memory.real_usage);
    states.DiskStationManager.info['memory_size'] = parseInt(res.memory.memory_size);
    return states;
};

module.exports.SystemStatus = (api, states, res) => {
    event.emit('debug', 'SystemStatus - Response: ' + JSON.stringify(res));
    states.DiskStationManager.info['is_disk_wcache_crashed'] = res.is_disk_wcache_crashed;
    states.DiskStationManager.info['is_system_crashed'] = res.is_system_crashed;
    states.DiskStationManager.info['upgrade_ready'] = res.upgrade_ready;
    return states;
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