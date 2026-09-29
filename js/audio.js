'use strict';
/* =========================================================
   Звук на WebAudio: настоящие записи (CC0) с пространственной
   обработкой; процедурный синтез — для остального и как запасной
   ========================================================= */
const Sfx = (() => {
  let ac = null, master = null, noiseBuf = null, comp = null, reverb = null, scene = null;
  let volume = .7; try { volume = Math.max(0,Math.min(1,+(localStorage.getItem('tw_volume') || .7))); } catch {}
  let enabled = true;
  try { enabled = localStorage.getItem('tw_sound') !== '0'; } catch (e) { /* нет доступа */ }
  const listener = { x: 0, y: 0, z: 1, w: 1600 };
  const last = {};
  const minGap = { footstep: .09, metalImpact: .02, stoneImpact: .02, woodImpact: .02, bounce: 0.05, shot: 0.03, flame: 0.12, jet: 0.09, tick: 0.2, hurt: 0.08, land: 0.08, beep: 0.1, dig: 0.07, explosion: 0.02 };
  let charge = null, ambient = null;

  function init() {
    if (ac) return;
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      comp = ac.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 5;
      master = ac.createGain(); master.gain.value = enabled ? volume : 0;
      master.connect(comp); comp.connect(ac.destination);
      reverb=ac.createConvolver();reverb.connect(master);makeImpulse();
      const len = ac.sampleRate * 2; noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      loadSamples();
    } catch (e) { ac = null; }
  }
  function resume() { init(); if (ac && ac.state === 'suspended') ac.resume(); }
  function makeImpulse() {
    if(!ac||!reverb)return;
    const theme=scene?scene.theme.id:'valley';
    const seconds={valley:1.3,desert:2.5,arctic:1.8,volcano:2.1,alien:2.3,tropical:1.1,castle:2.1,city:1.9}[theme]||1.5;
    const buffer=ac.createBuffer(2,Math.ceil(ac.sampleRate*seconds),ac.sampleRate);
    let seed=73219;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296*2-1;};
    for(let ch=0;ch<2;ch++){const a=buffer.getChannelData(ch);let filtered=0;
      for(let i=0;i<a.length;i++){filtered=filtered*.72+rnd()*.28;const t=i/ac.sampleRate;a[i]=filtered*Math.exp(-t*6/seconds)*Math.min(1,t/.025)*.45;}
      for(const [delay,gain] of [[.073,.3],[.131,.18],[.227,.11]])a[Math.floor((delay+ch*.009)*ac.sampleRate)]+=gain;
    }
    reverb.buffer=buffer;
  }
  function out(pos, vol = 1) {
    const g=ac.createGain();let v=vol,pan=0,distance=0,blocked=0;
    if(pos){
      const dx=pos.x-listener.x,dy=pos.y-listener.y;
      distance=Math.hypot(dx,dy*.65);pan=clamp(dx/(listener.w/Math.max(.4,listener.z)*.7),-.92,.92);
      v*=1/Math.sqrt(1+(distance/700)**2);
      if(scene&&scene.terrain){for(let u=.12;u<.95;u+=.1)if(scene.terrain.isSolid(listener.x+dx*u,listener.y+dy*u))blocked++;}
      v*=Math.pow(.9,blocked);
    }
    g.gain.value=v;
    const filter=ac.createBiquadFilter();filter.type='lowpass';filter.frequency.value=clamp(16000/(1+distance/1000+blocked*1.8),600,16000);
    const delay=ac.createDelay(.5);delay.delayTime.value=Math.min(.38,distance/12000);
    const panNode=ac.createStereoPanner();panNode.pan.value=pan;
    g.connect(filter);filter.connect(delay);delay.connect(panNode);panNode.connect(master);
    const wet=ac.createGain();wet.gain.value=pos ? .16+Math.min(.12,distance/12000) : .025;
    panNode.connect(wet);wet.connect(reverb);
    setTimeout(()=>{g.disconnect();filter.disconnect();delay.disconnect();panNode.disconnect();wet.disconnect();},8500);
    return g;
  }
  function firearm(pos,kind) {
    const config={shot:[.52,160,3100,.16],revolver:[.76,125,2800,.29],shotgun:[.92,86,3900,.34],sniper:[.96,110,5500,.48],autocannon:[.9,72,2200,.45]}[kind]||[.52,160,3100,.16];
    const [volume,body,crack,tail]=config,t=ac.currentTime,d=out(pos,volume),variation=.96+Math.random()*.08;
    noise(d,t,.022,{type:'highpass',f0:crack*variation,gain:.82,attack:.0008});
    noise(d,t+.002,.12,{type:'bandpass',f0:850*variation,f1:180,q:.55,gain:.65,attack:.001});
    tone(d,t+.001,.11,{f0:body*variation,f1:body*.5,gain:.45,attack:.001});
    noise(d,t+.018,tail,{f0:1400,f1:180,gain:.18,attack:.006});
    noise(d,t+.075,.035,{type:'highpass',f0:3600,gain:.085,attack:.001});
    if(kind==='shotgun'||kind==='sniper')noise(d,t+.36,.09,{type:'bandpass',f0:1800,f1:700,gain:.12,attack:.002});
  }
  function noise(dest, t0, dur, o = {}) {
    const src = ac.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ac.createBiquadFilter(); f.type = o.type || 'lowpass';
    f.frequency.setValueAtTime(o.f0 || 1000, t0);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t0 + dur);
    f.Q.value = o.q || 0.8;
    const g = ac.createGain(); const att = o.attack || 0.004;
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(o.gain || 0.5, t0 + att);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t0, Math.random() * 1.5); src.stop(t0 + dur + 0.05);
  }
  function tone(dest, t0, dur, o = {}) {
    const osc = ac.createOscillator(); osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f0 || 440, t0);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t0 + dur);
    const g = ac.createGain(); const att = o.attack || 0.004;
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(o.gain || 0.3, t0 + att);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(dest); osc.start(t0); osc.stop(t0 + dur + 0.05);
  }
  const S = {
    explosion(pos, size = 1) {
      const t = ac.currentTime, d = out(pos, 0.8 + size * 0.2);
      noise(d, t, 0.45 + size * 0.7, { f0: 2600 + size * 800, f1: 90, gain: 0.95 });
      tone(d, t, 0.35 + size * 0.45, { f0: 120, f1: 32, gain: 0.9 });
      noise(d, t + 0.02, 0.22, { type: 'bandpass', f0: 1600, f1: 300, q: 1.2, gain: 0.35 });
      if (size > 1.5) noise(d, t + 0.1, 1.8 + size * 0.5, { f0: 400, f1: 40, gain: 0.6, attack: 0.2 });
    },
    small(pos) { const t = ac.currentTime, d = out(pos, 0.6); noise(d, t, 0.25, { f0: 2200, f1: 150, gain: 0.7 }); tone(d, t, 0.18, { f0: 160, f1: 50, gain: 0.5 }); },
    shot(pos) { firearm(pos,'shot'); },
    revolver(pos) { firearm(pos,'revolver'); },
    autocannon(pos) { firearm(pos,'autocannon'); },
    shotgun(pos) { firearm(pos,'shotgun'); },
    sniper(pos) { firearm(pos,'sniper'); },
    launch(pos) { const t = ac.currentTime, d = out(pos, 0.7); noise(d, t, 0.45, { type: 'bandpass', f0: 350, f1: 2800, q: 1.4, gain: 0.55 }); tone(d, t, 0.3, { type: 'sawtooth', f0: 130, f1: 60, gain: 0.08 }); },
    throw(pos) { const t = ac.currentTime, d = out(pos, 0.5); noise(d, t, 0.18, { type: 'bandpass', f0: 600, f1: 1800, q: 2, gain: 0.35 }); },
    bounce(pos) { const t=ac.currentTime,d=out(pos,.35);noise(d,t,.045,{type:'bandpass',f0:2100,f1:800,gain:.3,attack:.001});tone(d,t,.075,{f0:1350,f1:1150,gain:.035,attack:.001}); },
    jump(pos) { const t=ac.currentTime,d=out(pos,.25);noise(d,t,.12,{type:'bandpass',f0:900,f1:350,gain:.3}); },
    land(pos) { const t=ac.currentTime,d=out(pos,.5);noise(d,t,.15,{f0:1000,f1:130,gain:.45});tone(d,t,.07,{f0:90,f1:40,gain:.17}); },
    footstep(pos) { const t=ac.currentTime,d=out(pos,.2),mat=scene?.terrain.materialAt(pos.x,pos.y+2)||1;noise(d,t,.075,{type:mat===6?'highpass':'lowpass',f0:mat===4?1300:mat===6?2600:850,f1:200,gain:.3,attack:.002});if(mat===6)tone(d,t,.06,{f0:660,f1:440,gain:.05}); },
    metalImpact(pos) {const t=ac.currentTime,d=out(pos,.38);noise(d,t,.025,{type:'highpass',f0:4200,gain:.6,attack:.001});for(const f of [1710,2490,3760])tone(d,t,.19,{f0:f,f1:f*.93,gain:.055,attack:.001});},
    woodImpact(pos) {const t=ac.currentTime,d=out(pos,.3);noise(d,t,.12,{type:'bandpass',f0:1700,f1:600,gain:.5});tone(d,t,.05,{f0:240,f1:100,gain:.13});},
    stoneImpact(pos) {const t=ac.currentTime,d=out(pos,.3);noise(d,t,.085,{type:'bandpass',f0:2700,f1:900,gain:.6,attack:.001});},
    splash(pos) {
      const t = ac.currentTime, d = out(pos, 0.8); noise(d, t, 0.7, { type: 'bandpass', f0: 1400, f1: 250, q: 0.7, gain: 0.7 });
      for (let i = 0; i < 4; i++) tone(d, t + 0.1 + i * 0.07, 0.08, { f0: 380 + Math.random() * 300, f1: 900 + Math.random() * 400, gain: 0.08 });
    },
    lavasplash(pos) { const t = ac.currentTime, d = out(pos, 0.8); noise(d, t, 0.9, { f0: 900, f1: 80, gain: 0.7 }); noise(d, t + 0.1, 1.2, { type: 'highpass', f0: 3000, gain: 0.15, attack: 0.1 }); },
    laser(pos) { const t = ac.currentTime, d = out(pos, 0.9); tone(d, t, 0.6, { type: 'sawtooth', f0: 2400, f1: 150, gain: 0.25 }); tone(d, t, 0.7, { f0: 70, f1: 40, gain: 0.6 }); noise(d, t, 0.5, { type: 'highpass', f0: 4000, gain: 0.2 }); },
    charge(pos) { const t = ac.currentTime, d = out(pos, 0.6); tone(d, t, 0.45, { type: 'sawtooth', f0: 120, f1: 1400, gain: 0.12, attack: 0.3 }); },
    zap(pos) {
      const t = ac.currentTime, d = out(pos, 1);
      for (let i = 0; i < 7; i++) noise(d, t + Math.random() * 0.25, 0.05, { type: 'highpass', f0: 2500, gain: 0.7 });
      noise(d, t + 0.05, 1.6, { f0: 900, f1: 50, gain: 0.9, attack: 0.02 });
      tone(d, t + 0.05, 1.2, { f0: 70, f1: 30, gain: 0.7 });
    },
    beep(pos) { const t = ac.currentTime, d = out(pos, 0.5); tone(d, t, 0.08, { type: 'square', f0: 1300, gain: 0.12 }); },
    fuse(pos) { const t = ac.currentTime, d = out(pos, 0.3); noise(d, t, 0.35, { type: 'highpass', f0: 5000, gain: 0.15 }); },
    plane(pos) { const t = ac.currentTime, d = out(null, 0.8); noise(d, t, 2.8, { type: 'bandpass', f0: 1100, f1: 260, q: 0.8, gain: 0.55, attack: 0.9 }); tone(d, t, 2.6, { type: 'sawtooth', f0: 210, f1: 90, gain: 0.05, attack: 0.9 }); },
    siren() {
      const t = ac.currentTime, d = out(null, 0.6);
      const osc = ac.createOscillator(); osc.type = 'sine'; const g = ac.createGain();
      for (let i = 0; i < 6; i++) osc.frequency.setValueAtTime(i % 2 ? 620 : 900, t + i * 0.35);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.1); g.gain.setValueAtTime(0.18, t + 1.9); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
      osc.connect(g); g.connect(d); osc.start(t); osc.stop(t + 2.3);
    },
    blackhole(pos) { const t = ac.currentTime, d = out(pos, 1); tone(d, t, 2.8, { f0: 90, f1: 28, gain: 0.6, attack: 0.3 }); noise(d, t, 2.8, { f0: 200, f1: 900, gain: 0.35, attack: 1.8 }); },
    flame(pos) { const t = ac.currentTime, d = out(pos, 0.6); noise(d, t, 0.3, { type: 'bandpass', f0: 800, q: 0.6, gain: 0.35, attack: 0.03 }); },
    tick() { const t = ac.currentTime, d = out(null, 0.5); tone(d, t, 0.05, { type: 'square', f0: 1100, gain: 0.08 }); },
    turn() { const t = ac.currentTime, d = out(null, 0.6); tone(d, t, 0.18, { type: 'triangle', f0: 660, gain: 0.2 }); tone(d, t + 0.11, 0.3, { type: 'triangle', f0: 990, gain: 0.2 }); },
    pickup(pos) { const t = ac.currentTime, d = out(pos, 0.7); [523, 659, 784, 1046].forEach((f, i) => tone(d, t + i * 0.07, 0.12, { type: 'triangle', f0: f, gain: 0.2 })); },
    die(pos) { const t=ac.currentTime,d=out(pos,.3);noise(d,t,.3,{f0:700,f1:120,gain:.4}); },
    teleport(pos) { const t = ac.currentTime, d = out(pos, 0.7); tone(d, t, 0.5, { f0: 250, f1: 2200, gain: 0.2 }); [1300, 1700, 2100].forEach((f, i) => tone(d, t + 0.15 + i * 0.06, 0.15, { type: 'triangle', f0: f, gain: 0.08 })); },
    jet(pos) { const t = ac.currentTime, d = out(pos, 0.5); noise(d, t, 0.16, { type: 'bandpass', f0: 520, q: 0.5, gain: 0.35, attack: 0.02 }); },
    build(pos) { const t = ac.currentTime, d = out(pos, 0.7); tone(d, t, 0.14, { type: 'square', f0: 160, f1: 70, gain: 0.2 }); noise(d, t, 0.18, { f0: 1800, f1: 300, gain: 0.35 }); tone(d, t + 0.1, 0.1, { type: 'triangle', f0: 1400, gain: 0.08 }); },
    bat(pos) { const t = ac.currentTime, d = out(pos, 0.9); noise(d, t, 0.07, { type: 'bandpass', f0: 2200, q: 1, gain: 0.9 }); tone(d, t, 0.12, { f0: 230, f1: 110, gain: 0.5 }); },
    hurt(pos) { const t = ac.currentTime, d = out(pos, 0.5); tone(d, t, 0.14, { type: 'triangle', f0: 330 + Math.random() * 60, f1: 170, gain: 0.14 }); },
    victory() { const t = ac.currentTime, d = out(null, 0.8); [[523, 0], [659, 0.14], [784, 0.28], [1046, 0.42], [784, 0.62], [1046, 0.76]].forEach(([f, dt]) => tone(d, t + dt, 0.35, { type: 'triangle', f0: f, gain: 0.22 })); },
    click() { const t = ac.currentTime, d = out(null, 0.5); tone(d, t, 0.04, { f0: 900, gain: 0.1 }); },
    select() { const t = ac.currentTime, d = out(null, 0.5); tone(d, t, 0.06, { type: 'triangle', f0: 700, f1: 1100, gain: 0.12 }); },
    dig(pos) { const t = ac.currentTime, d = out(pos, 0.5); noise(d, t, 0.1, { f0: 900, f1: 300, gain: 0.3 }); },
    rumble(pos) { const t = ac.currentTime, d = out(pos, 1); tone(d, t, 2.5, { f0: 55, f1: 25, gain: 0.8, attack: 0.05 }); noise(d, t, 3.5, { f0: 300, f1: 30, gain: 0.8, attack: 0.05 }); },
    denied() { const t = ac.currentTime, d = out(null, 0.5); tone(d, t, 0.15, { type: 'square', f0: 220, f1: 160, gain: 0.08 }); },
    thunder(pos) { const t = ac.currentTime, d = out(pos, 0.8); noise(d, t, 2.4, { f0: 420, f1: 60, gain: 0.5, attack: 0.25 }); tone(d, t + 0.1, 1.8, { f0: 48, f1: 30, gain: 0.35, attack: 0.3 }); },
    bombdrop(pos) { const t = ac.currentTime, d = out(pos, 0.7); tone(d, t, 1.4, { f0: 1500, f1: 420, gain: 0.07, attack: 0.05 }); noise(d, t, 0.12, { type: 'highpass', f0: 2500, gain: 0.25 }); },
  };
  /* ---------- настоящие записи (CC0, assets/sfx) поверх той же пространственной цепочки ---------- */
  const R4 = (p) => [0, 1, 2, 3].map(i => p + i);
  const REAL = {
    shot: { f: ['shot1', 'shot2', 'shot3'], v: 0.8, r: [0.94, 1.08] },
    revolver: { f: ['revolver1', 'revolver2'], v: 0.9, r: [0.96, 1.04] },
    sniper: { f: ['sniper1', 'sniper2'], v: 1, r: [0.88, 0.96] },
    shotgun: { f: ['shotgun1', 'shotgun2'], v: 1, r: [0.95, 1.03] },
    autocannon: { f: ['cannon1', 'cannon2'], v: 0.9, r: [1.08, 1.2] },
    launch: { f: ['launch1', 'launch2'], v: 0.75, r: [0.95, 1.05] },
    small: { f: ['small1', 'boom1', 'boom2'], v: 0.5, r: [1.15, 1.3] },
    bounce: { f: ['bounce1', 'bounce2'], v: 0.45, r: [0.9, 1.1], o: 0.1 },
    laser: { f: ['rail'], v: 0.8, r: [0.95, 1.02] },
    zap: { f: ['zap', 'rail'], v: 0.8, r: [0.9, 1.1] },
    thunder: { f: ['thunder'], v: 1, r: [0.9, 1.05], o: 0.8 },
    metalImpact: { f: ['ric1', 'ric2', ...R4('metal')], v: 0.45, r: [0.92, 1.1] },
    woodImpact: { f: R4('wood'), v: 0.5, r: [0.9, 1.1] },
    stoneImpact: { f: [...R4('stone'), 'ric1', 'ric2'], v: 0.4, r: [0.95, 1.15] },
    land: { f: R4('land'), v: 0.55, r: [0.9, 1.05] },
    bat: { f: R4('punch'), v: 0.9, r: [0.85, 0.95] },
    hurt: { f: R4('punch'), v: 0.35, r: [1.1, 1.3] },
    splash: { f: ['splash1', 'splash2'], v: 0.8, r: [0.85, 1] },
    select: { f: ['switch'], v: 0.45, r: [0.95, 1.05], ui: true },
  };
  const STEPS = { 1: 'stepGrass', 2: 'stepStone', 3: 'stepStone', 4: 'stepWood', 5: 'stepStone', 6: 'stepStone', 7: 'stepSnow', 8: 'stepStone', 9: 'stepStone' };
  const buffers = {};
  function loadSamples() {
    const names = new Set(Object.values(REAL).flatMap(e => e.f).concat(['boom1', 'boom2', 'boom3', 'boom4']));
    for (const k of ['stepGrass', 'stepStone', 'stepSnow', 'stepWood']) for (const n of R4(k)) names.add(n);
    for (const n of names) fetch(`assets/sfx/${n}.ogg`).then(r => r.ok ? r.arrayBuffer() : Promise.reject()).then(b => ac.decodeAudioData(b)).then(buf => { let pk = 0; for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i += 2) pk = Math.max(pk, Math.abs(d[i])); } buffers[n] = { buf, norm: clamp(0.9 / (pk || 1), 0.4, 6) }; }).catch(() => { /* останется синтез */ });
  }
  function sample(n, pos, vol, rate = 1, offset = 0) {
    const e = buffers[n]; if (!e) return false; const b = e.buf;   // громкость выровнена по пику записи
    const src = ac.createBufferSource(); src.buffer = b; src.playbackRate.value = rate;
    src.connect(out(pos, vol * e.norm)); src.start(ac.currentTime, Math.min(offset, b.duration - 0.05)); return true;
  }
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const rr = ([a, b]) => a + Math.random() * (b - a);
  function real(name, pos, arg) {
    if (name === 'explosion') {
      // запись взрыва + синтезированный низкий удар для веса; крупные взрывы ниже и громче
      const size = clamp(arg || 1, 0.6, 3), n = pick(size > 1.6 ? ['boom3', 'boom4', 'boom1'] : ['boom1', 'boom2', 'boom4']);
      if (!sample(n, pos, Math.min(1.1, 0.62 + size * 0.2), rr([0.84, 0.98]) / Math.sqrt(Math.max(1, size * 0.8)), n === 'boom3' ? 0.45 : 0)) return false;
      const t = ac.currentTime, d = out(pos, 0.55 + size * 0.15); tone(d, t, 0.5 + size * 0.35, { f0: 64, f1: 26, gain: 0.8 });
      // эхо от рельефа: приглушённый повтор через четверть-полсекунды
      setTimeout(() => { if (ac) sample(n, pos ? { x: pos.x, y: pos.y - 200 } : null, 0.22 + size * 0.06, 0.8); }, 250 + Math.random() * 200);
      return true;
    }
    if (name === 'footstep') {
      const mat = scene?.terrain.materialAt(pos.x, pos.y + 2) || 1;
      return sample(pick(R4(STEPS[mat] || 'stepStone')), pos, mat === 1 ? 0.6 : 0.45, rr([0.92, 1.08]));
    }
    const e = REAL[name]; if (!e) return false;
    return sample(pick(e.f), e.ui ? null : pos, e.v, rr(e.r), e.o || 0);
  }
  let silent = false;
  function setSilent(v) { silent = !!v; if (silent) chargeStop(); }
  function play(name, pos, arg) {
    if (silent || !enabled || !ac || ac.state !== 'running') return;
    const now = ac.currentTime;
    if (last[name] !== undefined && now - last[name] < (minGap[name] || 0.015)) return;
    last[name] = now;
    try { if (!real(name, pos, arg)) S[name] && S[name](pos, arg); } catch (e) { /* ignore */ }
  }
  /* непрерывный звук зарядки выстрела */
  function chargeStart() {
    if (silent || !enabled || !ac || ac.state !== 'running' || charge) return;
    const osc = ac.createOscillator(); osc.type = 'triangle'; const g = ac.createGain();
    osc.frequency.value = 200; g.gain.value = 0.0001; g.gain.exponentialRampToValueAtTime(0.06, ac.currentTime + 0.05);
    osc.connect(g); g.connect(master); osc.start(); charge = { osc, g };
  }
  function chargeSet(p) { if (charge) charge.osc.frequency.setTargetAtTime(200 + p * 700, ac.currentTime, 0.02); }
  function chargeStop() {
    if (!charge) return; const c = charge; charge = null;
    try { c.g.gain.setTargetAtTime(0.0001, ac.currentTime, 0.02); c.osc.stop(ac.currentTime + 0.1); } catch (e) { /* */ }
  }
  /* фоновая атмосфера карты */
  function setAmbient(kind) {
    stopAmbient();
    if (!ac || !kind) return;
    const src = ac.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ac.createBiquadFilter(); f.type = 'lowpass';
    const g = ac.createGain(); g.gain.value = 0.0001;
    const conf = { wind: [380, 0.05], lava: [160, 0.1], snow: [650, 0.06], space: [250, 0.04], sea: [500, 0.06] }[kind] || [400, 0.04];
    f.frequency.value = conf[0];
    const lfo = ac.createOscillator(); lfo.frequency.value = 0.13; const lg = ac.createGain(); lg.gain.value = conf[0] * 0.5;
    lfo.connect(lg); lg.connect(f.frequency); lfo.start();
    src.connect(f); f.connect(g); g.connect(master); src.start();
    g.gain.exponentialRampToValueAtTime(conf[1], ac.currentTime + 2);
    ambient = { src, g, lfo };
  }
  function stopAmbient() {
    if (!ambient) return; const a = ambient; ambient = null;
    try { a.g.gain.setTargetAtTime(0.0001, ac.currentTime, 0.3); a.src.stop(ac.currentTime + 1.5); a.lfo.stop(ac.currentTime + 1.5); } catch (e) { /* */ }
  }
  function toggle(v) {
    enabled = v === undefined ? !enabled : !!v;
    try { localStorage.setItem('tw_sound', enabled ? '1' : '0'); } catch (e) { /* */ }
    if (master) master.gain.setTargetAtTime(enabled ? volume : 0, ac.currentTime, 0.05);
    if (!enabled) chargeStop();
    return enabled;
  }
  function setScene(value) { scene=value;makeImpulse(); }
  function setVolume(value) {volume=clamp(Number(value)||0,0,1);try{localStorage.setItem('tw_volume',volume);}catch{}if(master)master.gain.setTargetAtTime(enabled?volume:0,ac.currentTime,.04);}
  function setListener(x, y, z, w) { listener.x = x; listener.y = y; listener.z = z; listener.w = w; }
  return { init, resume, play, chargeStart, chargeSet, chargeStop, setAmbient, stopAmbient, toggle, setListener, setSilent, setScene, setVolume, get volume() { return volume; }, get enabled() { return enabled; } };
})();
