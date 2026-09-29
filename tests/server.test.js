'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { WebSocket } = require('ws');
const { createServer } = require('../server');
function next(ws) { return new Promise((resolve,reject) => { const timer=setTimeout(()=>reject(new Error('Message timeout')),3000);ws.once('message',data=>{clearTimeout(timer);resolve(JSON.parse(data));}); }); }
async function connect(url) {const ws=new WebSocket(url);await once(ws,'open');return ws;}
test('Two-player room, relay, room isolation, full room and disconnect lifecycle', async () => {
  const {server,wss,rooms}=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');
  const url=`ws://127.0.0.1:${server.address().port}/room`;const sockets=[];
  try {
    const host=await connect(url);sockets.push(host);let pending=next(host);host.send(JSON.stringify({type:'create'}));const room=await pending;assert.match(room.code,/^[A-Z2-9]{5}$/);
    const guest=await connect(url);sockets.push(guest);const hostJoined=next(host);pending=next(guest);guest.send(JSON.stringify({type:'join',code:room.code}));assert.equal((await pending).type,'connected');assert.equal((await hostJoined).type,'connected');
    pending=next(host);guest.send(JSON.stringify({type:'relay',data:{t:'c',c:{c:'fire',pw:.5}}}));assert.equal((await pending).data.c.c,'fire');
    const extra=await connect(url);sockets.push(extra);pending=next(extra);extra.send(JSON.stringify({type:'join',code:room.code}));assert.equal((await pending).code,'full');
    pending=next(extra);extra.send(JSON.stringify({type:'create'}));const other=await pending;assert.notEqual(other.code,room.code);
    pending=next(host);guest.close();assert.equal((await pending).type,'left');assert.equal(rooms.get(room.code).guest,null);
    const replacement=await connect(url);sockets.push(replacement);pending=next(replacement);replacement.send(JSON.stringify({type:'join',code:room.code}));assert.equal((await pending).type,'connected');
    pending=next(replacement);host.close();assert.equal((await pending).type,'left');assert.equal(rooms.has(room.code),false);
  } finally {for(const s of sockets)s.terminate();for(const s of wss.clients)s.terminate();await new Promise(resolve=>server.close(resolve));}
});
test('HTTP serves the game but never local config, tests or dependencies', async()=>{
  const {server}=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base+'/')).status,200);
    assert.equal((await fetch(base+'/health')).status,200);
    for(const file of ['/package.json','/server.js','/.claude/settings.local.json','/node_modules/ws/package.json','/tests/server.test.js','/assets/../../package.json'])assert.equal((await fetch(base+file)).status,404,file);
  } finally {await new Promise(resolve=>server.close(resolve));}
});
