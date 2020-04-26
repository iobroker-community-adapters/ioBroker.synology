'use strict';
const EventEmitter = require('events');
const event = new EventEmitter();
module.exports = event;

module.exports.send = (syno, api, method, params, cb) => {
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
        //event.emit('error', '--- Send Error ' + JSON.stringify(e));
    }
};