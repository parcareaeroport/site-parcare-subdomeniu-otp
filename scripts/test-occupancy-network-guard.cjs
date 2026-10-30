const assert=require('node:assert/strict'),http=require('node:http'),https=require('node:https'),net=require('node:net')
require('./occupancy-network-guard.cjs')
for(const invoke of [()=>fetch('https://rezervari.otp-parking.ro'),()=>http.get('http://example.com'),()=>https.request('https://example.com'),()=>net.connect({host:'198.51.100.1',port:443})])assert.throws(invoke,/blocked external/)
console.log('PASS production HTTP, HTTPS, fetch and socket access blocked')
