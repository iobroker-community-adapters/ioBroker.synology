'use strict';
const EventEmitter = require('events');
const event = new EventEmitter();
const utils = require('../lib/utils.js');
module.exports = event;

///////////////////* AudioStation *////////////////////////////

function Browser(id, cb) {
    adapter.log.debug('--------------------- Browser -----------------------');
    let param = {};
    if (id && id !== '/') {
        param = {id: id};
    }
    send('as', 'listFolders', param, (res) => {
        let arr = [];
        res.items.forEach((k, i) => {
            let filetype = 'file';
            if (res.items[i].type === 'folder') {
                filetype = 'directory';
            }
            arr.push({
                "id": res.items[i].id,
                "file": res.items[i].path,
                "filetype": filetype,
                "title": res.items[i].title
            });
        });
        states.AudioStation.Browser = JSON.stringify(arr);
        cb && cb();
    });
}

function PlayControl(cmd, val, cb) {
    adapter.log.debug('--------------------- PlayControl -----------------------');
    let id = current_player;
    let param = {};
    if (id) {
        param = {
            id: id,
            action: cmd
        };
        if (cmd === 'set_volume') {
            if (val < 0) {
                val = 0;
            }
            if (val > 100) {
                val = 100;
            }
            param.value = val;
        }
        if (cmd === 'seek') {
            param.value = (states.AudioStation.duration / 100) * val;
        }
        adapter.log.debug('PlayControl cmd - ' + cmd + '. param - ' + JSON.stringify(param));
        send('as', 'controlRemotePlayer', param, (res) => {
            //current_player = '';
            cb && cb();
        });
    }
}

function PlayFolder(id, folder, limit, cb) {
    adapter.log.debug('--------------------- PlayFolder -----------------------');
    if (!id) {
        id = current_player;
    }
    let param = {};
    if (id) { //uuid:2eff7682-632d-6283-c2cc-29e985e5955c
        param = {
            id: id,
            library: 'shared',
            offset: 0,
            limit: 1,
            play: true,
            containers_json: [{
                "type": "folder",
                "id": folder,
                "recursive": true,
                "sort_by": "title",
                "sort_direction": "ASC"
            }]
        };
        send('as', 'updatePlayListRemotePlayer', param, (res) => {
            param = {
                id: id,
                action: 'play'
            };
            send('as', 'controlRemotePlayer', param, (res) => {
            });
        });
    }
}

function PlayTrack(id, track, cb) {
    adapter.log.debug('--------------------- PlayTrack -----------------------');
    if (!id) {
        id = current_player;
    }
    let param = {};
    if (id) { //uuid:bab0037b-3c03-7bb9-4d0a-7b093cb9358c
        param = {
            id: id,
            library: 'shared',
            offset: 0,
            limit: 1,
            play: true,
            songs: track,
            containers_json: []
        };
        send('as', 'updatePlayListRemotePlayer', param, (res) => {
            param = {
                id: id,
                action: 'play'
            };
            send('as', 'controlRemotePlayer', param, (res) => {
            });
        });

    }
}


//SYNO.AudioStation.RemotePlayer&method=control&id=PLAYERID&version=2&action=play
//SYNO.AudioStation.RemotePlayer&method=control&id=PLAYERID&version=2&action=stop
//SYNO.AudioStation.RemotePlayer&method=updateplaylist&library=shared&id=PLAYERID&offset=0&limit=0&play=true&version=2&containers_json=%5B%7B%22type%22%3A%22playlist%22%2C%22id%22%3A%22PLAYLISTID%22%7D%5D

