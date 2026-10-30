// Preloaded ONLY in acceptance-test child processes. No production networking.
const assert=require('node:assert/strict')
assert.match(process.env.FIRESTORE_EMULATOR_HOST||'',/^(127\.0\.0\.1|localhost):\d+$/,'Local emulator required')
const allowed=host=>['localhost','127.0.0.1','::1','[::1]'].includes(host)
function check(value){
 const host=typeof value==='string'||value instanceof URL?new URL(value).hostname:value?.hostname||value?.host?.split(':')[0]||'localhost'
 if(!allowed(host))throw Error('Acceptance tests blocked external network host: '+host)
}
const fetch=global.fetch;global.fetch=(input,...args)=>{check(typeof input==='string'||input instanceof URL?input:input.url);return fetch(input,...args)}
for(const protocol of ['node:http','node:https']){const mod=require(protocol);for(const method of ['request','get']){const original=mod[method];mod[method]=function(input,...args){check(input);return original.call(this,input,...args)}}}
const net=require('node:net'),original=net.Socket.prototype.connect
net.Socket.prototype.connect=function(...args){
 const options=Array.isArray(args[0])?args[0][0]:args[0]
 const host=typeof options==='object'?options.host||'localhost':typeof args[1]==='string'?args[1]:'localhost'
 if(!allowed(host))throw Error('Acceptance tests blocked external socket host: '+host)
 return original.apply(this,args)
}
