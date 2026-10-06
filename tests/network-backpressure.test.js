'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { once } = require('node:events');
const { createServer, createRelayQueue } = require('../server');
const { WebSocket } = require('ws');
const project = process.env.NETWORK_PROJECT || path.resolve(__dirname, '..');
function fixture(role, offset = 1) {
  const clock = { now: offset }, frames = [], events = [], errors = [];
  class FakeWebSocket { static OPEN=1; constructor(){this.readyState=1;this.bufferedAmount=0;} send(s){const d=JSON.parse(s);frames.push(d.data||d);} close(){this.readyState=3;} }
  const ctx = vm.createContext({ TextEncoder, performance: { now: () => clock.now }, console, location: { protocol: 'http:', origin: 'http://127.0.0.1' }, WebSocket: FakeWebSocket, setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}, URL, Date, Math });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/net.js'), 'utf8') + '\nglobalThis.api=Net;', ctx);
  const n = ctx.api;
  n.socket = { readyState: 1, bufferedAmount: 0, send(s) { frames.push(JSON.parse(s).data); }, close() { this.readyState = 3; } };
  n.linked = true; n.role = role; n.epoch = role; n.on('data', d => events.push(d)); n.on('error', e => errors.push(e));
  return { n, clock, frames, events, errors, ctx };
}
function transfer(from, to) { const d = from.frames.shift(); if (!d) return false; to.n.receive(d); return true; }
function drain(a, b) { for (let i=0;i<2000;i++) { a.n.flush(); b.n.flush(); const progress = transfer(a,b) | transfer(b,a); if (!progress && !a.frames.length && !b.frames.length) return; } throw Error('Transport did not drain'); }
const snapshot = (i, V = []) => ({ t:'s', ht:i*33, S:[[1,i,2]], E:[], T:{tm:0,sid:1}, V });

test('Slow consumer: one in-flight snapshot, latest positions, ordered world events and last TM survive 1000 replacements', () => {
  const a=fixture('host'),b=fixture('guest');
  for(let i=0;i<=1000;i++) { const m=snapshot(i,[{t:['carve','cline','girder','tidy','over'][i%5],order:i}]);if(i%100===0)m.TM=[{a:{bazooka:i},d:i,k:0}];a.n.send(m); }
  assert.equal(a.frames.length,1,'No hidden tunnel queue of old states');assert.equal(a.n.outbox.length,0);assert.equal(a.n.statePending.ht,33000);
  drain(a,b);const states=b.events.filter(d=>d.t==='s');assert.equal(states.length,2);assert.equal(states[1].S[0][1],1000);
  assert.deepEqual(states.flatMap(d=>d.V).map(e=>e.order),Array.from({length:1001},(_,i)=>i));assert.equal(states[1].TM[0].d,1000);
  assert.equal(a.n.stateFlight,null);assert.equal(a.n.statePending,null);assert.deepEqual(a.errors,[]);
});

test('Slow/hidden control path: mouse and held intent coalesce; stop and discrete-action barriers retain order', () => {
  const guest=fixture('guest'),host=fixture('host');
  guest.n.send({t:'c',c:{c:'ctrl',l:true,aim:0,pw:-1}});
  for(let i=1;i<=2000;i++)guest.n.send({t:'c',c:{c:'ctrl',l:true,aim:i/10,pw:-1}});
  guest.n.send({t:'c',c:{c:'ctrl',l:false,r:false,u:false,d:false,pw:-1}});
  guest.n.send({t:'c',c:{c:'weapon',id:'grenade'}});
  guest.n.send({t:'c',c:{c:'ctrl',l:false,aim:2,pw:.4}});
  guest.n.send({t:'c',c:{c:'fire',aim:2,pw:.4}});
  guest.n.send({t:'c',c:{c:'soldier',id:4}});
  guest.n.send({t:'c',c:{c:'jump'}});guest.n.send({t:'c',c:{c:'holster'}});
  assert.equal(guest.frames.length,1);assert.equal(guest.n.outbox.length,7);
  drain(guest,host);const commands=host.events.map(d=>d.c);
  assert.deepEqual(commands.map(c=>c.c),['ctrl','ctrl','weapon','ctrl','fire','soldier','jump','holster']);
  assert.equal(commands[1].l,false);assert.equal(commands[3].aim,2);assert.equal(commands.filter(c=>c.c==='ctrl').length,3);
  host.clock.now+=1001;host.n.pump();assert.equal(host.events.at(-1).c.l,false);assert.equal(host.events.at(-1).c.pw,-1);
});

test('RTT uses sender-local nonce, has one outstanding probe, shows full real delay and rejects expired replies', () => {
  const a=fixture('host',100),b=fixture('guest',900000);
  a.n.ping();const first=a.n.pingPending.n;a.n.ping();a.n.ping();assert.equal(a.frames.length,1);
  transfer(a,b);a.clock.now+=7800;transfer(b,a);assert.equal(a.n.rtt,7800);assert.equal(a.n.rttStatus,'ok');
  a.n.ping();const expired=a.n.pingPending.n;a.clock.now+=12001;a.n.pump();assert.equal(a.n.rtt,null);assert.equal(a.n.rttStatus,'timeout');
  a.n.receive({t:'pong',n:expired});a.n.receive({t:'pong',n:first});assert.equal(a.n.rtt,null);
  const current=a.n.pingPending.n;a.clock.now+=420;a.n.receive({t:'pong',n:current});assert.equal(a.n.rtt,420);assert.equal(a.n.rttStatus,'ok');
});

test('ACK deadline closes a stalled connection rather than building an endless queue or inventing a low ping', () => {
  const a=fixture('host');a.n.send(snapshot(1));a.n.send(snapshot(2,[{t:'carve',order:1}]));a.clock.now+=30001;a.n.pump();
  assert.equal(a.n.connected,false);assert.equal(a.errors[0].type,'slow');assert.equal(a.n.rtt,null);
});

test('Chunked mask and Unicode chat are reliable across a transfer lasting longer than the idle chunk timeout', () => {
  const a=fixture('host'),b=fixture('guest');const data={t:'mask',bits:'01'.repeat(125000),name:'Проверка маски'};
  a.n.sendBig(data);a.n.send({t:'chat',txt:'Проверка: уничтожение, балка и реванш'});a.n.send({t:'rematch'});
  for(let i=0;i<30;i++){a.n.flush();b.n.flush();if(!a.frames.length&&!b.frames.length)break;transfer(a,b);transfer(b,a);a.clock.now+=9000;b.clock.now+=9000;}
  assert.equal(b.events[0].t,'mask');assert.equal(b.events[0].bits,data.bits);assert.equal(b.events[1].t,'chat');assert.equal(b.events[2].t,'rematch');assert.equal(b.n.chunks.size,0);assert.deepEqual(a.errors,[]);
});

test('New match session rejects late previous-match controls; old ACKs cannot unlock a newer state', () => {
  const host=fixture('host'),guest=fixture('guest');host.n.send({t:'start',v:8,mapId:'valley'});drain(host,guest);const old=host.n.gameSession;
  host.n.send({t:'start',v:8,mapId:'city'});drain(host,guest);assert.notEqual(host.n.gameSession,old);
  const before=host.events.length;host.n.receive({t:'c',ns:old,c:{c:'ctrl',l:true}});assert.equal(host.events.length,before);
  host.n.send(snapshot(1));const q=host.n.stateFlight.q;host.n.receive({t:'net-ack',lane:'state',q:q-1});assert.equal(host.n.stateFlight.q,q);
  drain(host,guest);assert.equal(host.n.stateFlight,null);
});

test('Reliable actions are never silently discarded when a consumer exceeds the bounded queue', () => {
  const a=fixture('guest');for(let i=0;i<600&&a.n.connected;i++)a.n.send({t:'c',c:{c:'fire',aim:i,pw:1}});
  assert.equal(a.n.connected,false);assert.equal(a.errors.at(-1).type,'slow');
});

test('A replacement guest starts at sequence one in the same host room and old-peer ACKs cannot unlock current traffic', () => {
  const host=fixture('host');host.n.connect('host');const ws=host.n.socket;
  const message=m=>ws.onmessage({data:JSON.stringify(m)});
  message({type:'created',code:'ABCDE'});message({type:'connected'});
  host.n.receive({t:'net',q:100,e:'old-peer',items:[{t:'hello'}]});
  host.n.send(snapshot(1));const oldFlight={...host.n.stateFlight};host.n.send(snapshot(2));
  message({type:'left'});assert.equal(host.n.code,'ABCDE');assert.equal(host.n.role,'host');assert.equal(host.n.socket,ws);
  assert.equal(host.n.receivedReliable,0);assert.equal(host.n.stateFlight,null);assert.equal(host.n.statePending,null);assert.equal(host.n.rtt,null);
  message({type:'connected'});host.n.receive({t:'net',q:1,e:'new-peer',items:[{t:'hello'},{t:'team',name:'Новая команда'},{t:'ready'}]});
  assert.deepEqual(host.events.slice(-3).map(d=>d.t),['hello','team','ready']);
  host.n.send(snapshot(3));const q=host.n.stateFlight.q,e=host.n.stateFlight.e;
  host.n.receive({t:'net-ack',lane:'state',q,e:oldFlight.e});assert.equal(host.n.stateFlight.q,q);
  host.n.receive({t:'net-ack',lane:'state',q,e});assert.equal(host.n.stateFlight,null);
  const count=host.events.length;host.n.receive({t:'net',q:101,e:'old-peer',items:[{t:'chat',txt:'Старый игрок'}]});assert.equal(host.events.length,count);
});

test('A stale match snapshot cannot poison the current deduplication sequence', () => {
  const guest=fixture('guest');guest.n.gameSession='new';guest.n.receivedEpoch='host';guest.n.receivedState=5;
  guest.n.receive({...snapshot(100),q:100,e:'host',ns:'old'});assert.equal(guest.n.receivedState,5);
  guest.n.receive({...snapshot(6),q:6,e:'host',ns:'new'});assert.equal(guest.n.receivedState,6);assert.equal(guest.events.length,1);assert.equal(guest.events[0].ht,198);
});

test('Control lease works at local clock zero and release is safe when the receiver closes during its callback', () => {
  const host=fixture('host',0);host.n.receive({t:'c',c:{c:'ctrl',l:true}});let releases=0;
  host.n.on('data',d=>{if(d.c?.l===false){releases++;host.n.close();}});host.clock.now=1001;host.n.pump();assert.equal(releases,1);assert.equal(host.n.controlAt,null);
});

function blockedSocket() { return { readyState:1,bufferedAmount:1000000,sent:[],callbacks:[],closed:null,send(text,cb){this.sent.push(JSON.parse(text));this.callbacks.push(cb);},close(code,reason){this.closed={code,reason};this.readyState=3;} }; }
test('Relay backpressure: bounded latest state preserves every V and TM while priority ping and reliable chunks retain order', () => {
  const ws=blockedSocket(),q=createRelayQueue(ws);
  try {for(let i=0;i<1000;i++){const m=snapshot(i,[{t:'carve',order:i}]);if(i===400)m.TM=[{a:{grenade:2}}];q.push({type:'data',data:m});}
    q.push({type:'data',data:{t:'chunk',id:'mask',i:0,n:2,d:'a'}});q.push({type:'data',data:{t:'chat',txt:'Порядок'}});q.push({type:'data',data:{t:'chunk',id:'mask',i:1,n:2,d:'b'}});q.push({type:'data',data:{t:'pong',n:'nonce'}});
    assert.equal(q.stats().latestState,true);assert.equal(q.stats().reliable,3);assert.equal(ws.sent.length,0);
    ws.bufferedAmount=0;q.flush();while(ws.callbacks.length)ws.callbacks.shift()();
    assert.deepEqual(ws.sent.map(m=>m.data.t),['pong','chunk','chat','chunk','s']);const last=ws.sent.at(-1).data;assert.equal(last.ht,999*33);assert.equal(last.V.length,1000);assert.equal(last.TM[0].a.grenade,2);assert.equal(q.stats().queuedBytes,0);
  }finally{q.dispose();}
});

test('Relay closes explicitly on oversized reliable backlog and cleans its queues', () => {
  const ws=blockedSocket(),q=createRelayQueue(ws,{maxBytes:2048});try{for(let i=0;i<100&&!ws.closed;i++)q.push({type:'data',data:{t:'chat',txt:'x'.repeat(100)}});assert.equal(ws.closed.code,1013);assert.equal(q.stats().queuedBytes,0);}finally{q.dispose();}
});

test('Relay closes a send whose completion callback stalls even when bufferedAmount reports zero', () => {
  const ws=blockedSocket();ws.bufferedAmount=0;let time=0;const q=createRelayQueue(ws,{now:()=>time});
  try {q.push({type:'data',data:{t:'chat',txt:'Ожидание'}});assert.equal(q.stats().busy,true);time=30001;q.flush();assert.equal(ws.closed.code,1013);assert.equal(q.stats().queuedBytes,0);}
  finally{q.dispose();}
});

test('Real relay retains room isolation and relays protocol8 envelopes and peer replies', async () => {
  const {server,wss,rooms}=createServer({root:project});server.listen(0,'127.0.0.1');await once(server,'listening');const sockets=[];
  const next=ws=>new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('WS timeout')),3000);ws.once('message',raw=>{clearTimeout(t);resolve(JSON.parse(raw));});});
  const connect=async()=>{const ws=new WebSocket(`ws://127.0.0.1:${server.address().port}/room`);sockets.push(ws);await once(ws,'open');return ws;};
  try {const host=await connect();let p=next(host);host.send(JSON.stringify({type:'create'}));const room=await p;const guest=await connect(),joined=next(host);p=next(guest);guest.send(JSON.stringify({type:'join',code:room.code}));assert.equal((await p).type,'connected');await joined;
    p=next(guest);host.send(JSON.stringify({type:'relay',data:{t:'net',q:1,items:[{t:'chat',txt:'Здравствуйте'},{t:'rematch'}]}}));const data=await p;assert.equal(data.data.items[0].txt,'Здравствуйте');assert.equal(data.data.items[1].t,'rematch');
    p=next(host);guest.send(JSON.stringify({type:'relay',data:{t:'pong',n:'host:p1'}}));assert.equal((await p).data.n,'host:p1');
    const extra=await connect();p=next(extra);extra.send(JSON.stringify({type:'join',code:room.code}));assert.equal((await p).code,'full');
    p=next(host);guest.close();assert.equal((await p).type,'left');assert.equal(rooms.get(room.code).guest,null);
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/health`)).status,200);
  }finally{for(const ws of sockets)ws.terminate();for(const ws of wss.clients)ws.terminate();await new Promise(r=>server.close(r));}
});
