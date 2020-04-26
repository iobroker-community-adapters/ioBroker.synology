'use strict';
const EventEmitter = require('events');
const event = new EventEmitter();
const tools = require('../lib/tools.js');
module.exports = event;

///////////////////* AudioStation *////////////////////////////
module.exports.Browser = (syno, states, playerid, val, cb)=>{
    //adapter.log.debug('--------------------- Browser -----------------------');
    let param = {};
    if (val && val !== '/'){
        param = {id: val};
    }
    tools.send(syno, 'as', 'listFolders', param, (res) => {
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
        states.AudioStation.Browser = JSON.stringify(arr);
        cb && cb();
    });
};

module.exports.PlayControl = (syno, states, playerid, cmd, val, cb) => {
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
        tools.send(syno, 'as', 'controlRemotePlayer', param, (res) => {
            //cb && cb();
        });
    }
};

module.exports.PlayFolder = (syno, states, playerid, folder, cb) => {
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
        tools.send(syno, 'as', 'updatePlayListRemotePlayer', param, (res) => {
            param = {
                id:     playerid,
                action: 'play'
            };
            tools.send(syno, 'as', 'controlRemotePlayer', param, (res) => {
            });
        });
    }
}

module.exports.PlayTrack = (syno, states, playerid, val, cb) => {
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
        tools.send(syno, 'as', 'updatePlayListRemotePlayer', param, (res) => {
            param = {
                id:     playerid,
                action: 'play'
            };
            tools.send(syno, 'as', 'controlRemotePlayer', param, (res) => {
            });
        });
    }
};

//SYNO.AudioStation.RemotePlayer&method=updateplaylist&library=shared&id=PLAYERID&offset=0&limit=0&play=true&version=2&containers_json=%5B%7B%22type%22%3A%22playlist%22%2C%22id%22%3A%22PLAYLISTID%22%7D%5D

