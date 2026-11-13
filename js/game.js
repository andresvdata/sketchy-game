/*
 * Sketchy game logic: home screen, the big-screen host, and the phone player.
 *
 * Roles
 *   Host   - the TV/laptop. Owns all game state, deals prompts, scores, and
 *            broadcasts a small "host state" object to every phone.
 *   Player - each phone. Sends its own small "player state" object (name, drawing
 *            chunks, fake title, vote) to the host.
 *
 * Transport is PeerJS (WebRTC data channels). See docs/ARCHITECTURE.md.
 */
(function(){
'use strict';

/* ================= content + shared constants ================= */
const CATS=window.SKETCHY_PROMPTS;
const CAT_NAMES=Object.keys(CATS);
const {COLORS,COLOR_NAMES,ERASE,SZ,encode,decode,rdp,paint,chunk,encodeFitted}=window.SketchyCodec;
const FAKE_MS=75000, VOTE_MS=35000, SCORE_MS=10000;
const REDUCED=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const REPLAY_MS=REDUCED?0:2600;

/* ================= utils ================= */
const $app=document.getElementById('app');
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const shuffle=a=>{a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
const pick=a=>a[Math.floor(Math.random()*a.length)];
const norm=s=>String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const cap=s=>s?s.charAt(0).toUpperCase()+s.slice(1):s;
const listNames=n=>n.length<2?n.join(''):n.slice(0,-1).join(', ')+' and '+n[n.length-1];
const riso=t=>`<span class="riso" data-t="${esc(t)}">${esc(t)}</span>`;
const clean=(s,max)=>Array.from(String(s==null?'':s).replace(/[\u0000-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/g,'').replace(/\s+/g,' ').trim()).slice(0,max).join('');
const rid=n=>{const a='abcdefghijkmnpqrstuvwxyz23456789';let s='';for(let i=0;i<n;i++)s+=a[Math.floor(Math.random()*a.length)];return s;};
const ls={get(k){try{return localStorage.getItem(k);}catch(e){return null;}},set(k,v){try{localStorage.setItem(k,v);}catch(e){}}};
const bytes=s=>{try{return new TextEncoder().encode(s).length;}catch(e){return s.length*3;}};
const clampInt=(v,a,b)=>{v=Math.floor(Number(v));return Number.isFinite(v)?Math.min(b,Math.max(a,v)):a;};
const fmt=s=>Math.floor(s/60)+':'+String(s%60).padStart(2,'0');

/* ================= transport: direct browser-to-browser (PeerJS), no accounts ================= */
// roomState: 'ok' | 'unavailable' (PeerJS didn't load) | 'nortc' (browser has no WebRTC, e.g. many smart TVs)
let peer=null,live=false,lastPub='';
let roomState=(typeof window.Peer!=='function')?'unavailable':(typeof window.RTCPeerConnection!=='function'||typeof window.WebSocket!=='function')?'nortc':'ok';
// Diagnostics, so each screen can say *why* it isn't connected instead of a generic message.
let hostFail=null,hostSince=0;            // host: last signalling error type, and when hosting started
let netErr=null,netErrAt=0,connectAt=0;   // player: 'nogame' | 'direct' | 'broker' | 'browser', when, and when the last attempt began
let MODE='home',S=null,P=null,homeKey='';
const PEER_OPTS=window.SKETCHY_PEER||{debug:0};
const hostIdFor=code=>'sketchy-party-v1-'+String(code).toLowerCase();
const conns=new Map();
let lastHostMsg=null,hostConn=null,retryTimer=null,hostRetry=null,attemptTimer=null;
function killPeer(){clearTimeout(attemptTimer);hostFail=null;hostSince=0;netErr=null;connectAt=0;clearTimeout(retryTimer);clearTimeout(hostRetry);conns.clear();if(hostConn){try{hostConn.close();}catch(e){}}hostConn=null;if(peer){try{peer.destroy();}catch(e){}}peer=null;live=false;}
function hostOpen(){
  if(roomState!=='ok')return;
  const since=hostSince||Date.now(),fail=hostFail;
  killPeer();
  hostSince=since;hostFail=fail;
  let me;
  try{me=new Peer(hostIdFor(S.code),PEER_OPTS);}catch(e){hostFail='browser-incompatible';update();return;}
  peer=me;
  me.on('open',()=>{if(peer!==me)return;live=true;hostFail=null;lastPub='';hostPublish();update();});
  me.on('connection',conn=>{
    conn.on('open',()=>{conns.set(conn.peer,{conn,pres:{}});if(lastHostMsg){try{conn.send(lastHostMsg);}catch(e){}}});
    conn.on('data',msg=>{
      if(!msg||typeof msg!=='object'||msg.t!=='p'||!msg.pres||typeof msg.pres!=='object')return;
      const e=conns.get(conn.peer)||{conn,pres:{}};e.pres=msg.pres;conns.set(conn.peer,e);
      if(MODE==='host'&&S)hostOnPeers(peerList());
    });
    const gone=()=>{if(conns.get(conn.peer)&&conns.get(conn.peer).conn===conn){conns.delete(conn.peer);if(MODE==='host'&&S)hostOnPeers(peerList());}};
    conn.on('close',gone);conn.on('error',gone);
  });
  me.on('disconnected',()=>{if(peer!==me)return;live=false;update();clearTimeout(hostRetry);hostRetry=setTimeout(()=>{try{if(!me.destroyed)me.reconnect();}catch(e){}},1500);});
  me.on('error',err=>{
    if(peer!==me)return;
    // Code already taken. In an empty lobby just pick another; mid-game it's our own stale registration, so keep the code and retry below.
    if(err&&err.type==='unavailable-id'&&S.phase==='lobby'&&!S.players.length){S.code=makeCode();hostOpen();update();return;}
    if(err&&err.type==='peer-unavailable')return;
    live=false;hostFail=(err&&err.type)||'unknown';update();
    if(hostFail==='browser-incompatible')return; // retrying can't help
    clearTimeout(hostRetry);hostRetry=setTimeout(()=>{if(peer===me&&MODE==='host')hostOpen();},4000);
  });
}
const peerList=()=>Array.from(conns.values()).map(e=>({presence:e.pres,sameTab:false,updatedAt:0}));
function pubHost(o){
  const body=JSON.stringify(o);if(body===lastPub)return;lastPub=body;
  lastHostMsg={t:'h',pres:Object.assign({},o,{t:Date.now()})};
  conns.forEach(e=>{if(e.conn.open){try{e.conn.send(lastHostMsg);}catch(err){}}});
}
/*
 * Player connection loop.
 *
 * Every attempt uses a brand-new Peer. The public PeerJS broker answers "no such peer" within a fraction
 * of a second for a new peer's first offer, but stays silent for repeat offers from the same peer, so
 * reusing one would leave the phone waiting forever after its first miss.
 *
 * Each attempt ends in exactly one of: connected, or fail(reason) with
 *   'nogame'  - the broker has no host registered for this code
 *   'direct'  - the host exists but a direct WebRTC link couldn't be opened (different networks, VPN, firewall)
 *   'broker'  - this phone couldn't reach the broker at all
 *   'browser' - this browser has no WebRTC (no retry)
 */
function playerConnect(){
  clearTimeout(retryTimer);clearTimeout(attemptTimer);
  if(!P||!P.code||roomState!=='ok')return;
  if(hostConn){const old=hostConn;hostConn=null;try{old.close();}catch(e){}}
  if(peer){const old=peer;peer=null;try{old.destroy();}catch(e){}}
  live=false;
  let me;
  try{me=new Peer(PEER_OPTS);}catch(e){netErr='browser';netErrAt=Date.now();return;}
  peer=me;let opened=false;
  const fail=why=>{
    if(peer!==me)return;
    netErr=why;netErrAt=Date.now();clearTimeout(attemptTimer);
    hostConn=null;live=false;peer=null;try{me.destroy();}catch(e){}
    playerOnPeers([]);
    if(why!=='browser')scheduleRetry();
  };
  // No answer either way after 12 s: if we reached the broker, the host got our offer and the direct link is failing.
  attemptTimer=setTimeout(()=>{if(peer===me&&!(hostConn&&hostConn.open))fail(opened?'direct':'broker');},12000);
  me.on('open',()=>{
    if(peer!==me)return;
    opened=true;connectAt=Date.now();
    const c=me.connect(hostIdFor(P.code),{reliable:true});hostConn=c;
    c.on('open',()=>{if(hostConn!==c)return;clearTimeout(attemptTimer);live=true;netErr=null;try{c.send({t:'p',pres:P.pres});}catch(e){}update();});
    c.on('data',msg=>{if(hostConn!==c||!msg||msg.t!=='h'||!msg.pres)return;playerOnPeers([{presence:msg.pres,updatedAt:Date.now()}]);});
    const lost=()=>{if(hostConn===c)fail('direct');};
    c.on('close',lost);c.on('error',lost);
  });
  me.on('disconnected',()=>{
    // Losing the broker while the game link is up is harmless: quietly re-register.
    if(peer===me&&hostConn&&hostConn.open)setTimeout(()=>{try{if(!me.destroyed)me.reconnect();}catch(e){}},1500);
  });
  me.on('error',err=>{
    if(peer!==me||(hostConn&&hostConn.open))return;
    const type=err&&err.type;
    fail(type==='peer-unavailable'?'nogame':type==='browser-incompatible'?'browser':type==='webrtc'?'direct':'broker');
  });
}
/** Why can't this phone join? 'browser' | 'broker' | 'nogame' | 'direct' | 'wait' (no verdict yet). */
function joinProblem(){return netErr||'wait';}
/** Why isn't the big screen live? Returns null (fine or still connecting) | 'browser' | 'stuck'. */
function hostProblem(){
  if(live)return null;
  if(hostFail==='browser-incompatible')return'browser';
  return hostSince&&Date.now()-hostSince>8000?'stuck':null;
}
function scheduleRetry(){clearTimeout(retryTimer);retryTimer=setTimeout(()=>{if(MODE==='player'&&P&&P.code&&!(hostConn&&hostConn.open))playerConnect();},3000);}
function pubPlayer(patch){
  Object.assign(P.pres,patch);
  if(hostConn&&hostConn.open){try{hostConn.send({t:'p',pres:P.pres});}catch(e){}}
}

/* ================= shared render plumbing ================= */
function update(){
  if(MODE==='host'){hostPublish();hRender();}
  else if(MODE==='player')pRender();
  else renderHome();
}
function setScreen(html,key,prevKey){
  $app.innerHTML=html;
  if(key!==prevKey){const s=$app.firstElementChild;if(s)s.classList.add('enter');window.scrollTo(0,0);}
}

/* ================= home ================= */
function statusLine(){
  if(roomState==='ok')return `<div class="status ok"><span class="dot"></span>No accounts or apps needed. Players use their phone’s browser.</div>`;
  if(roomState==='nortc')return `<div class="status bad"><span class="dot"></span>This browser can’t run Sketchy because it doesn’t support direct connections (WebRTC). Use Chrome, Edge, Safari or Firefox on a phone or computer. For a TV, open the game on a laptop and show the laptop’s screen on the TV.</div>`;
  return `<div class="status bad"><span class="dot"></span>Couldn’t load the connection library. Check the internet connection and reload. Smart TV browsers often can’t load it: open the game on a laptop and show the laptop’s screen on the TV.</div>`;
}
function renderHome(){
  const k='home:'+roomState;if(k===homeKey)return;
  const prev=homeKey;homeKey=k;
  const can=roomState==='ok';
  setScreen(`<section class="screen"><div class="homegrid">
    <div style="display:flex;flex-direction:column;gap:18px">
      <div class="eyebrow">Drawing party game · 2 to 10 players</div>
      <h1 class="title-xl">${riso('Sketchy')}</h1>
      <p class="lede">Everyone draws a secret prompt on their phone. Then you all invent fake titles and vote for the real one on the big screen.</p>
      <ol class="steps">
        <li>Put the host screen on a TV or laptop everyone can see.</li>
        <li>Players scan the QR code on the big screen, or open this page on their phone and type the code.</li>
        <li>Draw, fake, vote. Fool your friends to score.</li>
      </ol>
    </div>
    <div class="modes">
      ${statusLine()}
      <button class="btn" data-act="goJoin" ${can?'':'disabled'}>Join on this phone</button>
      <button class="btn alt" data-act="goHost" ${can?'':'disabled'}>Host on the big screen</button>
    </div></div>
  </section>`,k,prev);
}

/* ================= HOST ================= */
function makeCode(){const a='BCDFGHJKLMNPQRSTVWXZ';let s='';for(let i=0;i<4;i++)s+=a[Math.floor(Math.random()*a.length)];return s;}
function freshHost(){return{code:makeCode(),phase:'lobby',settings:{rounds:2,timer:90,cats:CAT_NAMES.slice()},players:[],kicked:[],round:1,drawings:[],
  guessOrder:[],guessIdx:0,revealStep:0,end:0,until:0,stepStart:0,paused:false,pauseLeft:null,ack:{},rej:{},used:[],replay:{},note:'',armEnd:0,lastKey:''};}
const hp=pid=>S.players.find(p=>p.pid===pid);
const hn=pid=>(hp(pid)&&hp(pid).name)||'Someone';
const roundDraws=()=>S.drawings.filter(d=>d.round===S.round);
const cur=()=>S.drawings.find(d=>d.id===S.guessOrder[S.guessIdx]);
const hGuessers=d=>S.players.filter(p=>p.pid!==d.artist);
const strokeCache=new Map();
function strokesOf(d){if(!strokeCache.has(d.id))strokeCache.set(d.id,decode(d.data||''));return strokeCache.get(d.id);}

function deal(cat){
  let pool=CATS[cat].filter(t=>S.used.indexOf(t)<0);
  if(!pool.length){for(const c of shuffle(S.settings.cats)){pool=CATS[c].filter(t=>S.used.indexOf(t)<0);if(pool.length){cat=c;break;}}}
  if(!pool.length){S.used=[];pool=CATS[cat];}
  const t=pick(pool);S.used.push(t);return{cat,prompt:t};
}
function houseLie(cat,taken){
  const pools=[CATS[cat]||[]].concat(shuffle(S.settings.cats).map(c=>CATS[c]));
  for(const pool of pools){const c=shuffle(pool).find(t=>!taken.has(norm(t)));if(c)return c;}
  return null;
}
function hStartGame(){
  S.players=S.players.filter(p=>p.online);
  if(S.players.length<2){S.note='You need at least 2 players connected on their phones.';return;}
  S.players.forEach(p=>p.score=0);
  S.drawings=[];S.round=1;S.used=[];S.note='';S.paused=false;strokeCache.clear();
  hStartRound();
}
function hStartRound(){
  const cats=shuffle(S.settings.cats);
  shuffle(S.players).forEach((p,i)=>{
    const dl=deal(cats[i%cats.length]);
    S.drawings.push({id:rid(6),round:S.round,artist:p.pid,cat:dl.cat,prompt:dl.prompt,data:null,parts:null,n:0,complete:false,fakes:{},votes:{},opts:null,deltas:null,scored:false});
  });
  S.ack={};S.rej={};S.phase='draw';S.phaseStart=Date.now();
  const now=Date.now();S.end=now+S.settings.timer*1000;S.until=S.end+12000;
}
function hEndDraw(){
  const done=roundDraws().filter(d=>d.complete);
  S.drawings=S.drawings.filter(d=>d.round!==S.round||d.complete);
  if(!done.length){S.phase='lobby';S.end=S.until=0;S.note='No drawings arrived, so the round was cancelled. Check that everyone is connected and start again.';return;}
  S.guessOrder=shuffle(done.map(d=>d.id));S.guessIdx=0;hToFake();
}
function hToFake(){const now=Date.now();S.phaseStart=now;S.phase='fake';S.rej={};S.end=now+FAKE_MS;S.until=S.end+1500;S.replay[cur().id]=now;}
function hToVote(){
  const d=cur();
  const opts=[{k:'truth',t:d.prompt}],taken=new Set([norm(d.prompt)]);
  Object.keys(d.fakes).forEach(pid=>{opts.push({k:pid,t:d.fakes[pid]});taken.add(norm(d.fakes[pid]));});
  let h=0;while(opts.length<4){const t=houseLie(d.cat,taken);if(!t)break;taken.add(norm(t));opts.push({k:'house'+(h++),t});}
  d.opts=shuffle(opts);
  const now=Date.now();S.phaseStart=now;S.phase='vote';S.end=now+VOTE_MS;S.until=S.end+1500;
}
function hDeltas(d){
  const del={};S.players.forEach(p=>del[p.pid]=0);
  Object.keys(d.votes).forEach(v=>{const k=d.votes[v];if(!(v in del))return;if(k==='truth'){del[v]+=2;if(d.artist in del)del[d.artist]+=1;}else if(k in del&&k!==v)del[k]+=1;});
  d.deltas=del;
}
function revealSeq(d){
  const c={};Object.values(d.votes).forEach(k=>c[k]=(c[k]||0)+1);
  return d.opts.filter(o=>o.k!=='truth'&&c[o.k]).sort((a,b)=>c[a.k]-c[b.k]).concat([d.opts.find(o=>o.k==='truth')]);
}
function hStepTimer(){
  const d=cur(),seq=revealSeq(d),idx=Math.floor(S.revealStep/2),shown=S.revealStep%2===1;
  const dur=!shown?2600:(seq[idx].k==='truth'?4800:3400);
  S.stepStart=Date.now();S.until=S.stepStart+dur;S.end=0;
}
function hToReveal(){hDeltas(cur());S.phase='reveal';S.revealStep=0;hStepTimer();}
function hRevealNext(){
  const seq=revealSeq(cur());
  if(S.revealStep<seq.length*2-1){S.revealStep++;hStepTimer();return;}
  const d=cur();if(!d.scored){S.players.forEach(p=>p.score+=d.deltas[p.pid]||0);d.scored=true;}
  S.phase='scores';S.stepStart=Date.now();S.until=S.stepStart+SCORE_MS;S.end=0;
}
function hNextDrawing(){
  if(S.guessIdx<S.guessOrder.length-1){S.guessIdx++;hToFake();}
  else if(S.round<S.settings.rounds){S.round++;hStartRound();}
  else{S.phase='final';S.end=S.until=0;}
}
function hSkip(){
  const ph=S.phase;
  if(ph==='draw')hEndDraw();else if(ph==='fake')hToVote();else if(ph==='vote')hToReveal();
  else if(ph==='reveal')hRevealNext();else if(ph==='scores')hNextDrawing();
}
function hGo(fn){fn();hostPublish();hRender();}

function hostOnPeers(peers){
  let ch=false;const seen=new Set();
  for(const pr of peers){
    const z=pr.presence||{};
    if(pr.sameTab||z.role!=='player'||z.code!==S.code||typeof z.pid!=='string')continue;
    const pid=z.pid.slice(0,16);seen.add(pid);
    if(hHandle(pid,z))ch=true;
  }
  S.players.forEach(p=>{if(p.bot)return;const on=seen.has(p.pid);if(p.online!==on){p.online=on;ch=true;}});
  if(ch){hostPublish();hRender();}
}
function hHandle(pid,z){
  if(S.kicked.indexOf(pid)>=0)return false;
  let ch=false;const name=clean(z.name,12);
  let p=hp(pid);
  if(!p){
    if(S.phase!=='lobby'||S.players.length>=10||!name)return false;
    p={pid,name,score:0,online:true};S.players.push(p);ch=true;
  }else if(name&&p.name!==name&&S.phase==='lobby'){p.name=name;ch=true;}
  if(S.phase==='draw'&&z.sk&&typeof z.sk==='object'){
    const d=roundDraws().find(x=>x.artist===pid);
    if(d&&!d.complete&&z.sk.d===d.id){
      const n=clampInt(z.sk.n,1,40),i=clampInt(z.sk.i,0,n-1);
      const c=(Array.isArray(z.sk.c)?z.sk.c:[]).filter(x=>typeof x==='string').join('').replace(/[^A-Za-z0-9\-_.]/g,'');
      if(!d.parts||d.n!==n){d.parts=new Array(n).fill(null);d.n=n;}
      if(d.parts[i]==null){d.parts[i]=c;ch=true;}
      const a=d.id+':'+i;if(S.ack[pid]!==a){S.ack[pid]=a;ch=true;}
      if(d.parts.every(x=>x!=null)){d.data=d.parts.join('');d.parts=null;d.complete=true;strokeCache.delete(d.id);ch=true;}
    }
  }
  const d=cur();
  if(S.phase==='fake'&&d&&z.fake&&typeof z.fake==='object'&&z.fake.d===d.id&&pid!==d.artist&&!(pid in d.fakes)){
    const t=clean(z.fake.t,70).replace(/[.!?]+$/,''),x=String(z.fake.x||'').slice(0,12);
    if(t&&!(S.rej[pid]&&S.rej[pid].x===x)){
      if(norm(t)===norm(d.prompt)){S.rej[pid]={x,r:'truth'};}
      else if(Object.values(d.fakes).some(f=>norm(f)===norm(t))){S.rej[pid]={x,r:'dup'};}
      else{d.fakes[pid]=t;delete S.rej[pid];}
      ch=true;
    }
  }
  if(S.phase==='vote'&&d&&d.opts&&z.vote&&typeof z.vote==='object'&&z.vote.d===d.id&&pid!==d.artist){
    const o=clampInt(z.vote.o,-1,d.opts.length-1);
    if(o>=0&&d.opts[o].k!==pid&&d.votes[pid]!==d.opts[o].k){d.votes[pid]=d.opts[o].k;ch=true;}
  }
  return ch;
}
function hostPublish(){
  if(!S)return;
  const d=cur();
  const o={role:'host',code:S.code,ph:S.phase,rd:S.round,rds:S.settings.rounds,end:S.paused?0:(S.end||0),pz:S.paused?1:0,
    in:S.players.map(p=>p.pid),sc:{},pr:null,did:null,art:null,cat:null,opts:null,done:[],rej:null,ack:null};
  S.players.forEach(p=>o.sc[p.pid]=p.score);
  if(S.phase==='draw'){
    o.pr={};roundDraws().forEach(x=>o.pr[x.artist]=[x.cat,x.prompt,x.id]);
    o.done=roundDraws().filter(x=>x.complete).map(x=>x.artist);o.ack=S.ack;
  }
  if(d&&['fake','vote','reveal','scores'].indexOf(S.phase)>=0){o.did=d.id;o.art=d.artist;o.cat=d.cat;}
  if(S.phase==='fake'&&d){o.done=Object.keys(d.fakes);o.rej=S.rej;}
  if(S.phase==='vote'&&d){o.opts=d.opts.map(x=>cap(x.t));o.done=Object.keys(d.votes);}
  pubHost(o);
}
const BOT_NAMES=['Bot Pixel','Bot Doodle','Bot Scribble','Bot Crayon'];
function botDelay(pid,base){let h=0;for(const c of pid)h=(h*31+c.charCodeAt(0))%997;return base+(h%5)*1300;}
function botDoodle(){
  const strokes=[];const n=3+Math.floor(Math.random()*4);
  for(let s=0;s<n;s++){
    const ci=Math.floor(Math.random()*8),si=Math.floor(Math.random()*3),p=[];
    const kind=Math.random();let cx=200+Math.random()*600,cy=200+Math.random()*600;
    if(kind<0.4){const r=60+Math.random()*180;for(let a=0;a<=36;a++){const t=a/36*Math.PI*2;p.push([Math.round(cx+Math.cos(t)*r),Math.round(cy+Math.sin(t)*r*(0.7+Math.random()*0.1))]);}}
    else if(kind<0.7){for(let k=0;k<8;k++)p.push([Math.round(120+k*100),Math.round(cy+(k%2?-80:80))]);}
    else{let x=cx,y=cy;for(let k=0;k<40;k++){x=Math.max(20,Math.min(980,x+(Math.random()-.5)*90));y=Math.max(20,Math.min(980,y+(Math.random()-.5)*90));p.push([Math.round(x),Math.round(y)]);}}
    strokes.push({ci,si,p:p.map(q=>[Math.max(0,Math.min(1000,q[0])),Math.max(0,Math.min(1000,q[1]))])});
  }
  return encode(strokes);
}
function hBots(now){
  const bots=S.players.filter(p=>p.bot);if(!bots.length||S.paused)return false;
  let ch=false;const since=now-(S.phaseStart||now),d=cur();
  if(S.phase==='draw'){roundDraws().forEach(x=>{const p=hp(x.artist);if(p&&p.bot&&!x.complete&&since>botDelay(p.pid,4000)){x.data=botDoodle();x.complete=true;strokeCache.delete(x.id);ch=true;}});}
  else if(S.phase==='fake'&&d){bots.forEach(p=>{if(p.pid===d.artist||d.fakes[p.pid]||since<botDelay(p.pid,3500))return;
    const taken=new Set([norm(d.prompt)].concat(Object.values(d.fakes).map(norm)));const t=houseLie(d.cat,taken);if(t){d.fakes[p.pid]=t;ch=true;}});}
  else if(S.phase==='vote'&&d&&d.opts){bots.forEach(p=>{if(p.pid===d.artist||d.votes[p.pid]||since<botDelay(p.pid,2500))return;
    const ok=d.opts.filter(o=>o.k!==p.pid);if(ok.length){d.votes[p.pid]=pick(ok).k;ch=true;}});}
  return ch;
}
function hTick(){
  if(hBots(Date.now())){hostPublish();hRender();}
  if(S.phase==='lobby'){const nk=live+':'+hostProblem();if(nk!==S.netKey){S.netKey=nk;hRender();}}
  const now=Date.now();
  if(!S.paused){
    const ph=S.phase,d=cur();
    if(ph==='draw'){const rd=roundDraws();if((rd.length&&rd.every(x=>x.complete))||now>S.until)hGo(hEndDraw);}
    else if(ph==='fake'){const g=hGuessers(d).filter(p=>p.online);if((g.length&&g.every(p=>d.fakes[p.pid]))||now>S.until)hGo(hToVote);}
    else if(ph==='vote'){const g=hGuessers(d).filter(p=>p.online);if((g.length&&g.every(p=>d.votes[p.pid]))||now>S.until)hGo(hToReveal);}
    else if(ph==='reveal'&&now>S.until)hGo(hRevealNext);
    else if(ph==='scores'&&now>S.until)hGo(hNextDrawing);
  }
  hRefresh();
}
function hRefresh(){
  const now=Date.now();
  $app.querySelectorAll('[data-timer]').forEach(el=>{
    if(S.paused){el.textContent='Paused';el.className='htimer paused';return;}
    const left=Math.max(0,Math.ceil((S.end-now)/1000));
    el.textContent=S.end?fmt(left):'';el.className='htimer'+(S.end&&left<=10?' hurry':'');
  });
  $app.querySelectorAll('[data-autobar]').forEach(el=>{
    const span=Math.max(1,S.until-S.stepStart);
    const pct=S.paused?(S.pauseLeft&&S.pauseLeft.span>0?100-S.pauseLeft.until/S.pauseLeft.span*100:0):Math.min(100,(now-S.stepStart)/span*100);
    el.style.width=pct+'%';
  });
  const eb=$app.querySelector('[data-act="hEnd"]');
  if(eb){const armed=S.armEnd>now;eb.textContent=armed?'Sure? End game':'End game';eb.classList.toggle('warn',armed);}
}
let rafOn=false;
function ensureRaf(){if(!rafOn){rafOn=true;requestAnimationFrame(frame);}}
function frame(){
  rafOn=false;let again=false;
  $app.querySelectorAll('canvas[data-replay]').forEach(cv=>{
    const d=S&&S.drawings.find(x=>x.id===cv.dataset.replay);if(!d)return;
    const st=S.replay[d.id]||0;const p=REPLAY_MS?Math.min(1,(Date.now()-st)/REPLAY_MS):1;
    paint(cv,strokesOf(d),p);if(p<1)again=true;
  });
  if(again)ensureRaf();
}
function paintAll(){
  $app.querySelectorAll('canvas[data-draw]').forEach(cv=>{const d=S.drawings.find(x=>x.id===cv.dataset.draw);if(d)paint(cv,strokesOf(d),1);});
  if($app.querySelector('canvas[data-replay]'))ensureRaf();
}

/* ---- host views ---- */
function hHeader(){
  let info='';
  if(S.phase!=='lobby'&&S.phase!=='final'){
    info=`Round ${S.round} of ${S.settings.rounds}`;
    if(['fake','vote','reveal','scores'].indexOf(S.phase)>=0)info+=` · Drawing ${S.guessIdx+1} of ${S.guessOrder.length}`;
  }else if(S.phase==='final')info='Game over';
  return `<header class="htop"><div class="brand">${riso('Sketchy')}</div><div class="hinfo">${info}</div>
    <div class="hright">${S.phase!=='lobby'&&qrSvg(joinUrl())?`<figure class="qr mini" aria-label="QR code to rejoin">${qrSvg(joinUrl())}<figcaption>Rejoin</figcaption></figure>`:''}<span class="codechip">Code<b>${esc(S.code)}</b></span><span class="live${live?' on':''}">${live?'Live':'Reconnecting'}</span></div></header>`;
}
function hCtl(){
  if(S.phase==='lobby'||S.phase==='final')return'';
  return `<div class="hctl"><button class="hbtn" data-act="hPause">${S.paused?'Resume':'Pause'}</button><button class="hbtn" data-act="hNext">Skip ahead</button><button class="hbtn" data-act="hEnd">End game</button></div>`;
}
function board(deltas){
  const ps=S.players.slice().sort((a,b)=>b.score-a.score);let rank=0,last=null;
  return `<div class="board">${ps.map((p,i)=>{
    if(p.score!==last){rank=i+1;last=p.score;}
    const dl=deltas?(deltas[p.pid]||0):0;
    return `<div class="row${rank===1&&p.score>0?' lead':''}"><span class="rank">${rank}</span><span class="pn">${esc(p.name)}</span>${dl?`<span class="delta">+${dl}</span>`:'<span></span>'}<span class="pts">${p.score}</span></div>`;
  }).join('')}</div>`;
}
function joinUrl(bare){
  if(location.protocol==='file:')return bare?'this page':'';
  const base=location.origin+location.pathname;
  return bare?base.replace(/^https?:\/\//,'').replace(/index\.html$/,''):base+'#'+S.code;
}
function qrSvg(url){
  if(!url||typeof window.qrcode!=='function')return'';
  try{const q=window.qrcode(0,'M');q.addData(url);q.make();return q.createSvgTag({cellSize:6,margin:2,scalable:true});}catch(e){return'';}
}
const canvasTag=(d,mode)=>`<canvas class="bigcanvas" width="900" height="900" data-${mode}="${d.id}" role="img" aria-label="Drawing by ${esc(hn(d.artist))}"></canvas>`;
const HV={
lobby(){
  const n=S.players.filter(p=>p.online).length;
  const seg=(k,vals)=>`<div class="seg" role="group">${vals.map(([v,l])=>`<button data-act="hSet" data-k="${k}" data-v="${v}" aria-pressed="${String(S.settings[k])===v}">${l}</button>`).join('')}</div>`;
  const tiles=S.players.length?S.players.map(p=>`<span class="tile${p.online?'':' off'}">${esc(p.name)}<button class="tx" data-act="hKick" data-pid="${esc(p.pid)}" aria-label="Remove ${esc(p.name)}">✕</button></span>`).join(''):'<span class="small">Waiting for phones to join…</span>';
  return `<section class="screen">${hHeader()}<div class="stage">
    <div class="col">
      <div class="eyebrow">Join on your phone</div>
      <h1 class="htitle">${riso(live||!hostProblem()?'Grab your phones':'Hold on')}</h1>
      ${live?`      <div class="joinrow">${qrSvg(joinUrl())?`<figure class="qr" aria-label="QR code to join game ${esc(S.code)}">${qrSvg(joinUrl())}<figcaption>Scan to join</figcaption></figure>`:''}<div class="col" style="gap:.9rem">
        <p class="hlede">Scan with your phone camera, or go to <b class="url">${esc(joinUrl(true))}</b> and enter the code.</p>
        <div class="code-letters" aria-label="Game code ${esc(S.code)}">${S.code.split('').map(c=>`<span>${c}</span>`).join('')}</div></div></div>
      <p class="small">Ready for players. Being on the same Wi-Fi gives the smoothest connection.</p>`:hostProblem()?`<div class="card netwarn" role="alert">
        <div class="pill fake">Not connected</div>
        <div class="prompt-text">Phones can’t find this game yet</div>
        <p>${hostProblem()==='browser'?'This browser can’t host a game because it doesn’t support direct connections.':'This screen hasn’t been able to reach the matchmaking service, so the join code isn’t active. Still trying…'}</p>
        <p><b>Using a smart TV’s browser?</b> Most can’t host. Open the game in Chrome or Edge on a laptop and show the laptop’s screen on the TV with HDMI or casting.</p>
        <p class="small">Otherwise check this device’s internet connection, turn off any VPN, and reload.${hostFail?' (Reason: '+esc(hostFail)+')':''}</p>
      </div>`:`<p class="hlede">Connecting this screen… The join code appears as soon as it’s live.</p>`}
    </div>
    <div class="col panel">
      <div class="hblock"><div class="lbl">Players <span class="count">${n} of 10</span></div><div class="tiles">${tiles}</div></div>
      <div class="hblock"><div class="lbl">Categories <span class="count">${S.settings.cats.length} picked</span></div><div class="cats">${CAT_NAMES.map(c=>`<button class="cat" data-act="hCat" data-c="${esc(c)}" aria-pressed="${S.settings.cats.indexOf(c)>=0}">${esc(c)}</button>`).join('')}</div></div>
      <div class="hpair"><div class="hblock"><div class="lbl">Rounds</div>${seg('rounds',[['1','1'],['2','2'],['3','3']])}</div>
        <div class="hblock"><div class="lbl">Drawing time</div>${seg('timer',[['60','60s'],['90','90s'],['120','2 min']])}</div></div>
      <div class="hblock"><div class="lbl">Test mode <span class="count">${S.players.filter(p=>p.bot).length} bots</span></div>
        <div style="display:flex;gap:.8rem;align-items:center;flex-wrap:wrap"><button class="hbtn" data-act="hBot" ${S.players.length>=10||S.players.filter(p=>p.bot).length>=BOT_NAMES.length?'disabled':''}>Add a bot player</button>
        <span class="small">Bots draw, fake and vote by themselves so you can try a full game with just this screen and your phone.</span></div></div>
      <div class="err" role="alert">${esc(S.note)}</div>
      <button class="btn" data-act="hStart" ${n>=2?'':'disabled'}>${n>=2?`Start with ${n} players`:'Waiting for at least 2 players'}</button>
      <button class="btn quiet" data-act="hExit">Close this game</button>
    </div></div></section>`;
},
draw(){
  const tiles=roundDraws().map(d=>{const p=hp(d.artist);const busy=!d.complete&&d.parts&&d.parts.some(x=>x!=null);
    return `<span class="tile${d.complete?' done':busy?' busy':''}${p&&p.online?'':' off'}">${esc(hn(d.artist))}<i>${d.complete?'✓':busy?'sending':'drawing'}</i></span>`;}).join('');
  return `<section class="screen">${hHeader()}<div class="centerstage">
    <h1 class="htitle big">${riso('Draw on your phones!')}</h1>
    <p class="hlede">Everyone has a secret prompt from one of the categories. No letters or words in your drawing.</p>
    <div class="htimer" data-timer></div>
    <div class="tiles">${tiles}</div>
  </div>${hCtl()}</section>`;
},
fake(){
  const d=cur();
  return `<section class="screen">${hHeader()}<div class="stage">
    <figure class="artfig">${canvasTag(d,'replay')}<figcaption class="by">Drawn by ${esc(hn(d.artist))}</figcaption></figure>
    <div class="col">
      <span class="cattag">${esc(d.cat)}</span>
      <h2 class="htitle">What is this?</h2>
      <p class="hlede">Write a fake title on your phone. Make it sound like a real prompt.</p>
      <div class="htimer" data-timer></div>
      <div class="tiles">${hGuessers(d).map(p=>`<span class="tile${d.fakes[p.pid]?' done':''}${p.online?'':' off'}">${esc(p.name)}${d.fakes[p.pid]?'<i>✓</i>':''}</span>`).join('')}</div>
    </div></div>${hCtl()}</section>`;
},
vote(){
  const d=cur();
  return `<section class="screen">${hHeader()}<div class="stage">
    <figure class="artfig">${canvasTag(d,'draw')}<figcaption class="by">Drawn by ${esc(hn(d.artist))}</figcaption></figure>
    <div class="col">
      <span class="cattag">${esc(d.cat)}</span>
      <h2 class="htitle">Which one is real?</h2>
      <ul class="hopts">${d.opts.map(o=>`<li class="hopt">${esc(cap(o.t))}</li>`).join('')}</ul>
      <div style="display:flex;gap:1.4rem;align-items:center;flex-wrap:wrap"><div class="htimer" data-timer></div>
      <div class="tiles">${hGuessers(d).map(p=>`<span class="tile${d.votes[p.pid]?' done':''}${p.online?'':' off'}">${esc(p.name)}${d.votes[p.pid]?'<i>✓</i>':''}</span>`).join('')}</div></div>
    </div></div>${hCtl()}</section>`;
},
reveal(){
  const d=cur(),seq=revealSeq(d),idx=Math.floor(S.revealStep/2),shown=S.revealStep%2===1,o=seq[idx];
  const voters=Object.keys(d.votes).filter(v=>d.votes[v]===o.k).map(hn);
  let verdict='';
  if(shown){
    if(o.k==='truth')verdict=`<span class="pill truth">The real prompt</span><p>${voters.length?`${esc(listNames(voters))} +2 each. ${esc(hn(d.artist))} +${voters.length} for drawing it.`:`Nobody got it, so ${esc(hn(d.artist))} scores nothing this time.`}</p>`;
    else if(o.k.indexOf('house')===0)verdict=`<span class="pill house">House fake</span><p>The game wrote this one. No points for anyone.</p>`;
    else verdict=`<span class="pill fake">Fake by ${esc(hn(o.k))}</span><p>${esc(hn(o.k))} +${voters.length} for fooling ${voters.length===1?'one person':voters.length+' people'}.</p>`;
  }
  return `<section class="screen">${hHeader()}<div class="stage">
    <figure class="artfig">${canvasTag(d,'draw')}<figcaption class="by">Drawn by ${esc(hn(d.artist))}</figcaption></figure>
    <div class="col">
      <div class="eyebrow">Reveal ${idx+1} of ${seq.length}</div>
      <div class="card reveal${shown&&o.k==='truth'?' truth':''}">
        <div class="prompt-text">${esc(cap(o.t))}</div>
        <div class="picked">${voters.length?`Picked by <b>${esc(listNames(voters))}</b>`:'Nobody picked this one'}</div>
        ${verdict}
      </div>
      <div class="autobar"><i data-autobar></i></div>
    </div></div>${hCtl()}</section>`;
},
scores(){
  const d=cur();
  const last=S.guessIdx>=S.guessOrder.length-1;
  const nxt=!last?'Next drawing':(S.round<S.settings.rounds?`Round ${S.round+1}`:'Final results');
  return `<section class="screen">${hHeader()}<div class="stage">
    <figure class="artfig sm">${canvasTag(d,'draw')}<figcaption><b>${esc(cap(d.prompt))}</b><br>${esc(d.cat)} · drawn by ${esc(hn(d.artist))}</figcaption></figure>
    <div class="col">
      <h2 class="htitle">Scores</h2>
      ${board(d.deltas)}
      <div class="autobar"><i data-autobar></i></div>
      <p class="small">${nxt} coming up</p>
    </div></div>${hCtl()}</section>`;
},
final(){
  const top=Math.max(0,...S.players.map(p=>p.score));
  const winners=S.players.filter(p=>p.score===top).map(p=>p.name);
  let best=null;
  S.drawings.forEach(d=>Object.keys(d.fakes).forEach(pid=>{const n=Object.values(d.votes).filter(k=>k===pid).length;if(n>0&&(!best||n>best.n))best={n,text:d.fakes[pid],by:pid};}));
  const done=S.drawings.filter(d=>d.complete&&d.scored);
  return `<section class="screen">${hHeader()}<div class="stage" style="align-items:start">
    <div class="col">
      <div class="eyebrow">${winners.length>1?'Tied for the win':'Winner'}</div>
      <h1 class="htitle big">${riso(listNames(winners)||'Nobody')}</h1>
      <p class="hlede">${top} point${top===1?'':'s'}</p>
      ${best?`<div class="card tilt"><div class="eyebrow" style="margin-bottom:.4rem">Best fake</div><div class="prompt-text">${esc(cap(best.text))}</div><p class="small" style="margin-top:.6rem">by ${esc(hn(best.by))}, fooled ${best.n}</p></div>`:''}
    </div>
    <div class="col">${board(null)}
      <div class="hpair"><button class="btn" data-act="hAgain">Play again</button><button class="btn alt" data-act="hLobby">Back to lobby</button></div>
    </div></div>
    ${done.length?`<h2 class="htitle" style="font-size:2.4rem;margin-top:2.4rem">The gallery</h2><div class="gallery" style="margin-top:1.2rem">${done.map(d=>`<figure><canvas width="500" height="500" data-draw="${d.id}" role="img" aria-label="${esc(d.prompt)}"></canvas><figcaption><b>${esc(cap(d.prompt))}</b>by ${esc(hn(d.artist))}</figcaption></figure>`).join('')}</div>`:''}
  </section>`;
}
};
function hRender(){
  if(!S)return;
  const d=cur();
  const key=S.phase+':'+(d?d.id:'')+':'+S.revealStep;
  const prev=S.lastKey;S.lastKey=key;
  setScreen((HV[S.phase]||HV.lobby)(),key,prev);
  paintAll();hRefresh();
}

/* ================= PLAYER ================= */
function freshPlayer(){
  // Player id lives in sessionStorage: it survives a reload of this tab (so you rejoin as yourself)
  // but each tab gets its own, which makes testing with several tabs on one computer easy.
  let pid=null;try{pid=sessionStorage.getItem('sketchy-pid');}catch(e){}
  if(!/^[a-z0-9]{8}$/.test(pid||'')){pid=rid(8);try{sessionStorage.setItem('sketchy-pid',pid);}catch(e){}}
  return{code:null,name:ls.get('sketchy-name')||'',lastCode:ls.get('sketchy-code')||'',pid,pres:{},joined:false,joinAt:0,host:null,hostT:null,skew:0,
    upload:null,submitted:null,fake:null,vote:null,draft:'',err:'',lastKey:null};
}
function playerOnPeers(peers){
  let host=null;
  if(P.code)for(const pr of peers){const z=pr.presence||{};if(z.role==='host'&&z.code===P.code&&(!host||pr.updatedAt>host.updatedAt))host=pr;}
  P.host=host?host.presence:null;
  if(P.host&&P.host.t!==P.hostT){P.hostT=P.host.t;P.skew=(Number(P.host.t)||Date.now())-Date.now();}
  pAck();pRender();
}
function pAck(){
  const up=P.upload,h=P.host;if(!up||!h)return;
  if(h.ph!=='draw'||(Array.isArray(h.done)&&h.done.indexOf(P.pid)>=0)){finishUpload();return;}
  if(h.ack&&h.ack[P.pid]===up.d+':'+up.i){up.i++;if(up.i>=up.chunks.length)finishUpload();else sendChunk();}
}
function sendChunk(){const up=P.upload;pubPlayer({sk:{d:up.d,n:up.chunks.length,i:up.i,c:up.chunks[up.i]}});}
function finishUpload(){if(!P.upload)return;P.upload=null;pubPlayer({sk:null});}
function pKey(){
  if(roomState!=='ok')return'noroom';
  if(!P.code)return'join';
  const h=P.host;
  if(!h)return P.joined?'lost':(Date.now()-P.joinAt<7000?'finding':'nohost:'+joinProblem());
  const inn=Array.isArray(h.in)&&h.in.indexOf(P.pid)>=0;
  if(!inn)return h.ph==='lobby'?'joining':'busy';
  P.joined=true;
  const done=Array.isArray(h.done)&&h.done.indexOf(P.pid)>=0;
  switch(h.ph){
    case'lobby':return'lobby:'+(h.in||[]).length+':'+live;
    case'draw':{const m=h.pr&&h.pr[P.pid];if(!Array.isArray(m))return'wait';const did=m[2];
      if(done)return'drawn:'+did;if(P.submitted===did)return'sending:'+did;return'draw:'+did;}
    case'fake':{if(h.art===P.pid)return'yours:fake:'+h.did;if(done)return'faked:'+h.did;
      const rj=h.rej&&h.rej[P.pid];const rejected=!!(rj&&P.fake&&P.fake.d===h.did&&rj.x===P.fake.x);
      const pending=!!(P.fake&&P.fake.d===h.did&&!rejected);
      return'fake:'+h.did+(pending?':p':'')+(rejected?':r'+rj.x:'')+(P.err?':e':'');}
    case'vote':{if(h.art===P.pid)return'yours:vote:'+h.did;const mv=(P.vote&&P.vote.d===h.did)?P.vote.o:-1;return'vote:'+h.did+':'+mv+':'+(h.opts?h.opts.length:0);}
    case'reveal':case'scores':return'watch:'+(h.sc?h.sc[P.pid]:0);
    case'final':return'final:'+JSON.stringify(h.sc||{});
  }
  return'wait';
}
const myScore=()=>(P.host&&P.host.sc&&P.host.sc[P.pid])||0;
const watchMsg=(title,body)=>`<section class="screen"><div class="spacer"></div><h2 class="title-l">${riso(title)}</h2><p class="lede">${body}</p><div class="spacer"></div>
  <div class="card"><div class="eyebrow">Your score</div><div class="bigstat">${myScore()}</div></div><div class="spacer"></div></section>`;
const PV={
noroom(){return `<section class="screen"><h1 class="title-l">${riso('Sketchy')}</h1>${statusLine()}</section>`;},
join(){return `<section class="screen">
  <div class="eyebrow">Join a game</div>
  <h1 class="title-l">${riso('Sketchy')}</h1>
  <label class="lbl" for="jcode">Code from the big screen</label>
  <input class="field code" id="jcode" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${esc(P.lastCode)}" placeholder="ABCD">
  <label class="lbl" for="jname">Your name</label>
  <input class="field" id="jname" maxlength="12" autocomplete="nickname" value="${esc(P.name)}" placeholder="What should we call you?">
  <div class="err" role="alert">${esc(P.err)}</div>
  <div class="actions"><button class="btn" data-act="pJoin">Join game</button><button class="btn quiet" data-act="goHome">Back</button></div>
</section>`;},
finding(){return `<section class="screen"><div class="spacer"></div><h2 class="title-m">Looking for game ${esc(P.code)}…</h2><p>Make sure the big screen is showing this code.</p><div class="spacer"></div></section>`;},
nohost(){
  const why=joinProblem(),code=esc(P.code);
  const M={
    nogame:['No game '+code+' is live','No big screen is hosting this code right now. Check the code, and check that the big screen shows a green <b>Live</b> in its top-right corner. Reloading the big screen makes a new code.'],
    direct:['Found game '+code+', but can’t connect','This phone reached the game but couldn’t open a direct connection to the big screen. Put this phone on the <b>same Wi-Fi</b> as the big screen, switch off mobile data and any VPN, and avoid guest Wi-Fi.'],
    broker:['Can’t reach the matchmaking service','This phone couldn’t reach the service that introduces phones to the big screen. Check its internet connection and turn off any VPN or ad blocker.'],
    browser:['This browser can’t join','It doesn’t support direct connections. Open the game in Chrome, Safari, Edge or Firefox.'],
    wait:['Still looking for game '+code,'This is taking longer than usual. Check the code on the big screen.']
  }[why];
  return `<section class="screen"><div class="spacer"></div><h2 class="title-m">${M[0]}</h2><p>${M[1]}</p><p class="small">${why==='browser'?'':'Still trying in the background…'}</p><div class="spacer"></div>
  <div class="actions"><button class="btn" data-act="pRetry">Try again</button><button class="btn quiet" data-act="pLeave">Change code</button></div></section>`;},
joining(){return `<section class="screen"><div class="spacer"></div><h2 class="title-m">Joining…</h2><p>The big screen will show your name in a moment. If it doesn’t, the game may be full.</p><div class="spacer"></div>
  <div class="actions"><button class="btn quiet" data-act="pLeave">Change code</button></div></section>`;},
busy(){return `<section class="screen"><div class="spacer"></div><h2 class="title-m">This game already started</h2><p>Hang tight. You’ll join automatically when it goes back to the lobby.</p><div class="spacer"></div>
  <div class="actions"><button class="btn quiet" data-act="pLeave">Change code</button></div></section>`;},
lost(){return `<section class="screen"><div class="spacer"></div><h2 class="title-m">Lost the big screen</h2><p>Reconnecting… Keep the game screen open on the TV or laptop, and keep this page open.</p><div class="spacer"></div>
  <div class="actions"><button class="btn quiet" data-act="pLeave">Leave game</button></div></section>`;},
lobby(){const n=(P.host.in||[]).length;return `<section class="screen"><div class="spacer"></div>
  <div class="eyebrow">You’re in</div><h1 class="title-l">${riso(P.name)}</h1>
  <p class="lede">Watch the big screen. ${n} player${n===1?'':'s'} so far. The game starts when the host is ready.</p><div class="spacer"></div>
  <div class="actions"><button class="btn quiet" data-act="pLeave">Leave game</button></div></section>`;},
wait(){return watchMsg('Hang on','Getting the next part ready.');},
draw(){
  const m=P.host.pr[P.pid];
  const ERASER=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"><path d="M4 16l9-9 6 6-7 7H7z"/><path d="M10 10l6 6"/><path d="M12 20h8"/></svg>`;
  const UNDO=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/></svg>`;
  return `<section class="screen draw">
  <div class="drawtop"><div class="dp"><span class="cattag">${esc(m[0])}</span><div class="dprompt">${esc(cap(m[1]))}</div></div>
    <div class="timer" data-ptimer aria-label="Time left"></div><button class="donebtn" id="doneBtn">Done</button></div>
  <div class="canvaswrap"><canvas id="cv" width="720" height="720" aria-label="Drawing canvas"></canvas></div>
  <div class="tools">
    <div class="swatches">${COLORS.map((c,i)=>`<button class="sw" data-ci="${i}" style="background:${c}" aria-label="${COLOR_NAMES[i]}" aria-pressed="${i===0}"></button>`).join('')}</div>
    <div class="toolrow">
      ${SZ.map((s,i)=>`<button class="tool" data-si="${i}" aria-label="${['Thin','Medium','Thick'][i]} brush" aria-pressed="${i===1}"><span class="dot" style="width:${[6,11,18][i]}px;height:${[6,11,18][i]}px"></span></button>`).join('')}
      <button class="tool" data-tool="erase" aria-label="Eraser" aria-pressed="false">${ERASER}</button>
      <button class="tool" data-tool="undo" aria-label="Undo">${UNDO}</button>
      <button class="tool" data-tool="clear" id="clearBtn" aria-label="Clear drawing">Clear</button>
    </div>
  </div></section>`;
},
sending(){return `<section class="screen"><div class="spacer"></div><h2 class="title-m">Sending your drawing…</h2><p class="small" data-progress></p><p>Keep this page open for a few seconds.</p><div class="spacer"></div></section>`;},
drawn(){return watchMsg('Nice work','Your drawing is on the big screen’s pile. Waiting for everyone else to finish.');},
fake(){
  const h=P.host;const rj=h.rej&&h.rej[P.pid];
  const rejected=!!(rj&&P.fake&&P.fake.d===h.did&&rj.x===P.fake.x);
  const pending=!!(P.fake&&P.fake.d===h.did&&!rejected);
  const msg=P.err||(rejected?(rj.r==='truth'?'You guessed the real prompt! Write a fake one instead so you don’t give it away.':'Someone already wrote that. Try another.'):'');
  return `<section class="screen">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><span class="cattag">${esc(h.cat||'')}</span><div class="timer" data-ptimer></div></div>
  <h2 class="title-m">What’s on the big screen?</h2>
  <p>Write a fake title that sounds like a real ${esc((h.cat||'').toLowerCase())} prompt. Fool people into picking it.</p>
  <label class="lbl" for="fake-in">Your fake title</label>
  <textarea class="field" id="fake-in" maxlength="70" placeholder="A very believable lie" ${pending?'disabled':''}>${esc(P.draft)}</textarea>
  <div class="err" role="alert">${esc(msg)}</div>
  <div class="actions"><button class="btn" data-act="pFake" ${pending?'disabled':''}>${pending?'Locking in…':'Lock it in'}</button>
  <button class="btn alt" data-act="pAuto" ${pending?'disabled':''}>Make one up for me</button></div></section>`;
},
faked(){return watchMsg('Locked in','Waiting for the others to finish their fakes.');},
yours(){const v=P.host.ph==='vote';return `<section class="screen"><div class="spacer"></div><div class="eyebrow">That’s your drawing</div>
  <h2 class="title-l">${riso('Act natural')}</h2><p class="lede">${v?'They’re voting on your drawing. Keep a straight face.':'Everyone else is writing fake titles for it. Don’t give anything away.'}</p><div class="spacer"></div></section>`;},
vote(){
  const h=P.host;const mine=(P.vote&&P.vote.d===h.did)?P.vote.o:-1;
  const myFake=(P.fake&&P.fake.d===h.did)?norm(P.fake.t):null;
  const opts=(h.opts||[]).map((t,i)=>({t,i})).filter(o=>norm(o.t)!==myFake);
  return `<section class="screen">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><span class="cattag">${esc(h.cat||'')}</span><div class="timer" data-ptimer></div></div>
  <h2 class="title-m">Which one is real?</h2>
  <div class="opts">${opts.map(o=>`<button class="opt" data-act="pVote" data-o="${o.i}" aria-pressed="${mine===o.i}">${esc(o.t)}</button>`).join('')}</div>
  <p class="small">${mine>=0?'Vote counted. You can change it until time runs out.':'Your own fake is hidden from your list.'}</p></section>`;
},
watch(){return watchMsg('Eyes up','Look at the big screen for the reveal.');},
final(){
  const sc=P.host.sc||{};const ids=(P.host.in||[]).filter(id=>id in sc);const mine=sc[P.pid]||0;
  const rank=1+ids.filter(id=>sc[id]>mine).length;
  return `<section class="screen"><div class="spacer"></div><div class="eyebrow">Final result</div>
  <h1 class="title-xl">${riso('#'+rank)}</h1><p class="lede">${rank===1?'You won':'You placed '+rank+' of '+ids.length} with ${mine} point${mine===1?'':'s'}. The full scores and gallery are on the big screen.</p><div class="spacer"></div></section>`;
}
};
function pRender(force){
  if(!P)return;
  const key=pKey();
  if(key===P.lastKey&&!force){pRefresh();return;}
  const prev=P.lastKey;
  const stillDrawing=D&&prev&&key===prev;
  if(stillDrawing){pRefresh();return;}
  if(prev&&prev.indexOf('fake:')===0){const el=document.getElementById('fake-in');if(el&&!el.disabled)P.draft=el.value;}
  cleanupDraw();
  P.lastKey=key;
  const name=key.split(':')[0];
  setScreen((PV[name]||PV.wait)(),key,prev);
  if(name==='draw')initDraw(key.slice(5));
  pRefresh();
}
function pRefresh(){
  const h=P.host,now=Date.now();
  $app.querySelectorAll('[data-ptimer]').forEach(el=>{
    if(!h){el.textContent='';return;}
    if(h.pz){el.textContent='Paused';el.classList.remove('hurry');return;}
    if(!h.end){el.textContent='';return;}
    const left=Math.max(0,Math.ceil((h.end-P.skew-now)/1000));
    el.textContent=fmt(left);el.classList.toggle('hurry',left<=10);
  });
  const pg=$app.querySelector('[data-progress]');
  if(pg)pg.textContent=P.upload?`Part ${Math.min(P.upload.i+1,P.upload.chunks.length)} of ${P.upload.chunks.length}`:'Almost there';
}
function pTick(){
  pRender();
  const h=P.host;
  if(D&&h&&h.ph==='draw'&&h.end&&!h.pz&&Date.now()>=h.end-P.skew-400)submitDrawing();
}

/* ---- player drawing ---- */
let D=null;
function initDraw(did){
  const cv=document.getElementById('cv');if(!cv)return;
  D={did,cv,ctx:cv.getContext('2d'),ci:0,si:1,erase:false,strokes:[],cur:null,pid:null,armClear:0,armDone:0,t1:null,t2:null};
  paint(cv,D.strokes,1);sizeCanvas();
  window.addEventListener('resize',sizeCanvas);
  cv.addEventListener('pointerdown',down);cv.addEventListener('pointermove',move);
  cv.addEventListener('pointerup',up);cv.addEventListener('pointercancel',up);
  $app.querySelector('.tools').addEventListener('click',toolClick);
  document.getElementById('doneBtn').addEventListener('click',doneClick);
}
function cleanupDraw(){if(!D)return;clearTimeout(D.t1);clearTimeout(D.t2);window.removeEventListener('resize',sizeCanvas);D=null;}
function sizeCanvas(){
  if(!D)return;
  const top=$app.querySelector('.drawtop').offsetHeight,tools=$app.querySelector('.tools').offsetHeight;
  const s=Math.max(200,Math.floor(Math.min($app.clientWidth-44,window.innerHeight-top-tools-72)));
  D.cv.style.width=s+'px';D.cv.style.height=s+'px';
}
function pt(e){
  const r=D.cv.getBoundingClientRect(),w=D.cv.clientWidth||1;
  const c=v=>Math.max(0,Math.min(1000,Math.round(v)));
  return[c((e.clientX-r.left-D.cv.clientLeft)*1000/w),c((e.clientY-r.top-D.cv.clientTop)*1000/w)];
}
function down(e){
  if(!D||D.cur)return;e.preventDefault();
  try{D.cv.setPointerCapture(e.pointerId);}catch(_){}
  D.pid=e.pointerId;const p=pt(e);
  D.cur={ci:D.erase?ERASE:D.ci,si:D.si,p:[p]};D.strokes.push(D.cur);
  const k=D.cv.width/1000,x=D.ctx;
  x.fillStyle=D.cur.ci===ERASE?'#FFFFFF':COLORS[D.cur.ci];x.beginPath();x.arc(p[0]*k,p[1]*k,SZ[D.cur.si]*(D.erase?1.8:1)*k/2,0,Math.PI*2);x.fill();
}
function move(e){
  if(!D||!D.cur||e.pointerId!==D.pid)return;e.preventDefault();
  let evs=e.getCoalescedEvents?e.getCoalescedEvents():[];if(!evs.length)evs=[e];
  const st=D.cur,k=D.cv.width/1000,x=D.ctx;
  x.lineCap='round';x.lineJoin='round';
  x.strokeStyle=st.ci===ERASE?'#FFFFFF':COLORS[st.ci];x.lineWidth=SZ[st.si]*(st.ci===ERASE?1.8:1)*k;
  x.beginPath();let last=st.p[st.p.length-1];x.moveTo(last[0]*k,last[1]*k);
  evs.forEach(ev=>{const p=pt(ev);if(p[0]===last[0]&&p[1]===last[1])return;st.p.push(p);last=p;x.lineTo(p[0]*k,p[1]*k);});
  x.stroke();
}
function up(e){if(!D||e.pointerId!==D.pid)return;D.cur=null;D.pid=null;}
function syncTools(){
  if(!D)return;const now=Date.now();
  $app.querySelectorAll('.sw').forEach(b=>b.setAttribute('aria-pressed',String(!D.erase&&+b.dataset.ci===D.ci)));
  $app.querySelectorAll('[data-si]').forEach(b=>b.setAttribute('aria-pressed',String(+b.dataset.si===D.si)));
  $app.querySelector('[data-tool="erase"]').setAttribute('aria-pressed',String(D.erase));
  document.getElementById('clearBtn').textContent=D.armClear>now?'Sure?':'Clear';
  const db=document.getElementById('doneBtn');db.textContent=D.armDone>now?'Submit?':'Done';db.classList.toggle('armed',D.armDone>now);
}
function toolClick(e){
  const b=e.target.closest('button');if(!b||!D)return;
  if(b.dataset.ci!=null){D.ci=+b.dataset.ci;D.erase=false;}
  else if(b.dataset.si!=null){D.si=+b.dataset.si;}
  else if(b.dataset.tool==='erase'){D.erase=!D.erase;}
  else if(b.dataset.tool==='undo'){D.strokes.pop();paint(D.cv,D.strokes,1);}
  else if(b.dataset.tool==='clear'){
    if(D.armClear>Date.now()){D.strokes=[];paint(D.cv,D.strokes,1);D.armClear=0;}
    else{D.armClear=Date.now()+2500;clearTimeout(D.t1);D.t1=setTimeout(syncTools,2600);}
  }
  syncTools();
}
function doneClick(){
  if(!D)return;
  if(D.armDone>Date.now()){submitDrawing();return;}
  D.armDone=Date.now()+2500;clearTimeout(D.t2);D.t2=setTimeout(syncTools,2600);syncTools();
}
function submitDrawing(){
  if(!D)return;
  const did=D.did,strokes=D.strokes.filter(s=>s.p.length);
  cleanupDraw();
  const chunks=chunk(encodeFitted(strokes,42000),950,3);
  P.upload={d:did,chunks,i:0};P.submitted=did;
  pubPlayer({fake:null,vote:null});sendChunk();
  pRender();
}

/* ================= actions ================= */
function setMode(m){
  MODE=m;
  document.documentElement.classList.toggle('host',m==='host');
  homeKey='';lastPub='';
}
const A={
  goHost(){setMode('host');S=freshHost();hostOpen();hRender();},
  goJoin(){setMode('player');P=freshPlayer();pRender(true);},
  goHome(){killPeer();setMode('home');S=null;P=null;try{history.replaceState(null,'',location.pathname);}catch(e){}renderHome();},
  /* host */
  hCat(ds){const c=ds.c,a=S.settings.cats,i=a.indexOf(c);if(i>=0){if(a.length>1)a.splice(i,1);}else a.push(c);hRender();},
  hSet(ds){S.settings[ds.k]=+ds.v;hostPublish();hRender();},
  hKick(ds){S.kicked.push(ds.pid);S.players=S.players.filter(p=>p.pid!==ds.pid);hostPublish();hRender();},
  hStart(){hGo(hStartGame);},
  hBot(){const used=S.players.map(p=>p.name);const name=BOT_NAMES.find(n=>used.indexOf(n)<0);if(!name||S.players.length>=10)return;
    S.players.push({pid:'bot'+rid(5),name,score:0,online:true,bot:true});hostPublish();hRender();},
  hAgain(){hGo(hStartGame);},
  hLobby(){hGo(()=>{S.phase='lobby';S.drawings=[];S.round=1;S.end=S.until=0;S.paused=false;S.players.forEach(p=>p.score=0);S.note='';strokeCache.clear();});},
  hExit(){A.goHome();},
  hPause(){
    const now=Date.now();
    if(!S.paused){S.pauseLeft={end:S.end?S.end-now:0,until:S.until?S.until-now:0,span:S.until-S.stepStart};S.paused=true;}
    else{const l=S.pauseLeft||{end:0,until:0,span:0};S.end=l.end?now+l.end:0;S.until=l.until?now+l.until:0;if(l.span>0)S.stepStart=S.until-l.span;S.paused=false;}
    hostPublish();hRender();
  },
  hNext(){if(S.paused){S.paused=false;}hGo(hSkip);},
  hEnd(){const now=Date.now();if(S.armEnd>now){S.armEnd=0;hGo(()=>{S.phase='final';S.end=S.until=0;S.paused=false;});}else{S.armEnd=now+2500;hRefresh();}},
  /* player */
  pJoin(){
    const code=clean(document.getElementById('jcode').value,8).toUpperCase().replace(/[^A-Z]/g,'').slice(0,4);
    const name=clean(document.getElementById('jname').value,12);
    P.lastCode=code;P.name=name;
    if(code.length!==4){P.err='Enter the 4-letter code from the big screen.';pRender(true);return;}
    if(!name){P.err='Add your name so the others know who drew what.';pRender(true);return;}
    P.err='';ls.set('sketchy-name',name);ls.set('sketchy-code',code);
    P.code=code;P.joinAt=Date.now();P.joined=false;P.host=null;
    Object.assign(P.pres,{role:'player',code,pid:P.pid,name,sk:null,fake:null,vote:null});
    playerConnect();pRender();
  },
  pRetry(){P.joinAt=Date.now();netErr=null;playerConnect();pRender();},
  pLeave(){pubPlayer({role:null,code:null,sk:null,fake:null,vote:null});killPeer();P.code=null;P.joined=false;P.host=null;P.upload=null;pRender(true);},
  pFake(){
    const h=P.host;if(!h||h.ph!=='fake')return;
    const el=document.getElementById('fake-in');const t=clean(el?el.value:'',70).replace(/[.!?]+$/,'');
    P.draft=t;
    if(!t){P.err='Write something first, or tap “Make one up for me”.';pRender(true);return;}
    P.err='';P.fake={d:h.did,t,x:rid(6)};
    pubPlayer({fake:P.fake});pRender(true);
  },
  pAuto(){
    const h=P.host;const pool=CATS[h&&h.cat]||CATS[pick(CAT_NAMES)];
    const el=document.getElementById('fake-in');if(el){el.value=cap(pick(pool));P.draft=el.value;}
    return'stay';
  },
  pVote(ds){const h=P.host;if(!h||h.ph!=='vote')return;P.vote={d:h.did,o:+ds.o};pubPlayer({vote:P.vote});pRender();}
};
$app.addEventListener('click',e=>{
  const el=e.target.closest('[data-act]');if(!el||el.disabled)return;
  const fn=A[el.dataset.act];if(fn)fn(el.dataset,el);
});
$app.addEventListener('input',e=>{
  if(e.target.id==='fake-in'&&P){P.draft=e.target.value;if(P.err){P.err='';}}
  if(e.target.id==='jcode')e.target.value=e.target.value.toUpperCase().replace(/[^A-Z]/g,'');
});
$app.addEventListener('keydown',e=>{
  if(e.key==='Enter'&&(e.target.id==='jname'||e.target.id==='jcode')){e.preventDefault();A.pJoin();}
});

/* ================= boot ================= */
function start(){
  const m=/^#([A-Za-z]{4})$/.exec(location.hash||'');
  if(m&&roomState==='ok'){setMode('player');P=freshPlayer();P.lastCode=m[1].toUpperCase();pRender(true);
    const n=document.getElementById(P.name?'jcode':'jname');if(n&&!P.name)try{n.focus();}catch(e){}}
  else update();
  setInterval(()=>{if(MODE==='host'&&S)hTick();else if(MODE==='player'&&P)pTick();},250);
  window.addEventListener('beforeunload',()=>{if(peer)try{peer.destroy();}catch(e){}});
}
start();
})();
