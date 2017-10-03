"use strict";

var utils =    require(__dirname + '/lib/utils'); // Get common adapter utils
var adapter = utils.adapter('synology');
var Syno = require('syno');
var states = {
    'DiskStationManager':    {
        'info': {},
        'resources':{},
        'system_status':{}

    },
    'FileStation':           {
        'info': {}
    },
    'DownloadStation':       {},
    'AudioStation':          {},
    'VideoStation':          {},
    'VideoStation_DTV':      {},
    'SurveillanceStation':   {}
};
var old_states = {
    'dsm_info': {},
    'fs_info': {}
};
var api = {
   'DiskStationManager':  { name: 'dsm',  installed: true  },
   'FileStation':         { name: 'fs',   installed: false },
   'DownloadStation':     { name: 'dl',   installed: false },
   'AudioStation':        { name: 'as',   installed: false },
   'VideoStation':        { name: 'vs',   installed: false },
   'VideoStation_DTV':    { name: 'dt',   installed: false },
   'SurveillanceStation': { name: 'ss',   installed: false }
};
var params, poll_time = 5000, _poll;
var syno = new Syno({
    host: /*adapter.config.host ? adapter.config.host: */'192.168.1.19',
    port: /*adapter.config.port ? adapter.config.port: */'5000',
    account: /*adapter.config.login ? adapter.config.login: */'admin2',
    passwd: /*adapter.config.password ? adapter.config.password: */'qwerty',
    protocol: /*adapter.config.https ? 'https' : */'http',
    apiVersion: /*adapter.config.version ? adapter.config.version: */'6.0.2'
});

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

        if(api[name]){
            //TODO params
            if(~val.indexOf(',')){
                var arr = val.split(',');
                params = [arr[1]];
                val = arr[0];
            }
            send(api[name]['name'], val, params ? params : null, function (res){
                if(res){
                    var id = name +'.sendMethod';
                    adapter.setState(id, {val: JSON.stringify(res), ack: true});
                }
            });
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
    main();
});
var count = 0;
function main() {
    clearTimeout(_poll);
    getPollingData(function (){
        adapter.setState('info.connection', true, true);
        getDSMInfo();
        if(api.FileStation.installed){
            getFSInfo();
        }
        polling();
    });
}

function polling(){
    clearTimeout(_poll);
    //count++;
    _poll = setTimeout(
        function (){
            getSystemUtilization(function (){
                polling();
                /*if(count > 5){
                    count = 0;
                    getPollingData();
                }*/
            });
        }, poll_time);
}

function getSystemUtilization(cb){
    send('dsm', 'getSystemUtilization', function (res){
        states.DiskStationManager.resources = res;
        send('dsm', 'getSystemStatus', function (res){
            states.DiskStationManager.system_status = res;
            if(cb){cb();}
        });
    });
}
function getPollingData(cb){
    send('dsm', 'getPollingData', function (res){
        Object.keys(res.packages).forEach(function(k) {
            if(api[k]){
                api[k]['installed'] = res.packages[k];
            }
        });
        if(cb){cb();}
    });
}
function getFSInfo(){
    send('fs', 'getInfo', function (res){
        Object.keys(res).forEach(function(k) {
            states.FileStation.info[k] = res[k];
        });
    });
}
function getDSMInfo(){
    send('dsm', 'getInfo', function (res){
        Object.keys(res).forEach(function(k) {
            states.DiskStationManager.info[k] = res[k];
        });
    });
}

//////////////////////////////////////////////////////////////////////////////////
function send(api, method, params, cb){
    if(typeof params == 'function'){
        cb = params;
        params = null;
    }
    syno[api][method](params, function(err, data) {
        if(!err){
            adapter.log.debug('---DEBUG RES DATA--- :{"api": ' + api + ', "method": ' + method + ' } \r\nRESPONSE: ' + JSON.stringify(data));
        } else{
            error(err)
        }
        if(cb && !err){
            cb(data);
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
    //
}