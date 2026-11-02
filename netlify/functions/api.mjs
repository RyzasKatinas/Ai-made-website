import crypto from 'node:crypto';
import {getStore} from '@netlify/blobs';

const YT=process.env.YOUTUBE_API_KEY,SECRET=process.env.JWT_SECRET;
const S=n=>getStore({name:n,consistency:'strong'});
const h=s=>crypto.createHash('sha1').update(s).digest('hex').slice(0,24);
class E extends Error{constructor(m,c=400,x){super(m);this.c=c;this.x=x}}
const j=(o,c=200)=>new Response(JSON.stringify(o),{status:c,headers:{'content-type':'application/json','cache-control':'no-store'}});
const enc=encodeURIComponent,rnd=n=>Math.floor(Math.random()*n),pick=a=>a[rnd(a.length)];
const shuffle=a=>a.map(x=>[Math.random(),x]).sort((p,q)=>p[0]-q[0]).map(x=>x[1]);
const STRONG=/\b(fuck|shit|bitch|cunt|nazi|kill yourself)\b/i,MILD=/\b(damn|hell|crap|stupid|idiot)\b/gi; // starter lists: use a real moderation service in production
const BAD=/\b(nude|naked|porn|sex|sexy|erotic|nsfw|gore|fetish|xxx)\b/i;
const LANGS=['en-US','es-ES','fr-FR','de-DE','pt-BR','ja-JP'];
const TOPICS={comedy:['funny','comedy sketch'],gaming:['gameplay','video game'],science:['science experiment','physics'],technology:['technology','robot'],education:['educational','how it works'],entertainment:['music performance','dance'],nature:['wildlife','nature'],travel:['travel','city timelapse']};
const YTCAT={comedy:23,gaming:20,science:28,technology:28,education:27,entertainment:24,nature:15,travel:19};
const ID=/^(yt|commons|archive|ph):[\w.\-]{1,200}$/;
const dec=s=>String(s).replace(/&(amp|lt|gt|quot|#39);/g,m=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[m]));
const J=async u=>{const r=await fetch(u,{headers:{'user-agent':'RandomScroll/2.0 (Netlify)'},signal:AbortSignal.timeout(6000)});if(!r.ok)throw new Error(new URL(u).hostname+' '+r.status);return r.json()};

/* ---- auth (HMAC tokens + scrypt, no dependencies) ---- */
const b64=b=>Buffer.from(b).toString('base64url');
const mac=s=>crypto.createHmac('sha256',SECRET).update(s).digest('base64url');
const sign=uid=>{const p=b64(JSON.stringify({uid,exp:Date.now()+30*864e5}));return p+'.'+mac(p)};
const verify=t=>{try{if(!SECRET||!t)return null;const[p,m]=t.split('.');const a=Buffer.from(m),b=Buffer.from(mac(p));if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return null;const d=JSON.parse(Buffer.from(p,'base64url'));return d.exp>Date.now()?d.uid:null}catch{return null}};
const hashpw=(pw,salt)=>crypto.scryptSync(pw,salt,32).toString('hex');
const getUser=uid=>uid?S('users').get('u/'+uid,{type:'json'}):null;
const needUser=async uid=>{const u=await getUser(uid);if(!u)throw new E('Log in to do that',401);return u};
const putUser=u=>S('users').setJSON('u/'+u.id,u);
/* ---- age, adult gate, admin, bans ---- */
const ageOf=dob=>{const[y,m,d]=dob.split('-').map(Number),n=new Date();let a=n.getUTCFullYear()-y;if(n.getUTCMonth()+1<m||(n.getUTCMonth()+1===m&&n.getUTCDate()<d))a--;return a};
const validDob=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(Date.parse(s))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s&&ageOf(s)>=0&&ageOf(s)<=120;
const isAdmin=u=>{if(!u)return false;const A=(process.env.ADMIN_IDS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);return A.includes(u.id.toLowerCase())||A.includes(String(u.email).toLowerCase())};
const needAdmin=async uid=>{const u=await needUser(uid);if(!isAdmin(u))throw new E('Admins only',403);return u};
const isBanned=u=>!!u?.ban&&(!u.ban.until||u.ban.until>Date.now());
const banMsg=u=>`Your account is banned ${u.ban.until?'until '+new Date(u.ban.until).toISOString().slice(0,10):'permanently'}${u.ban.reason?': '+u.ban.reason:''}`;
const banIndex=async(id,ban)=>{const A=S('admin'),ix=(await A.get('bans',{type:'json'}))||{};if(ban)ix[id]=ban;else delete ix[id];await A.setJSON('bans',ix)};
const adultOK=u=>!!u&&!!u.dob&&ageOf(u.dob)>=18&&!isBanned(u);   // 18+ with a birthday on file
const adultOn=u=>adultOK(u)&&!!u.adult_on;                          // ...and opted in
const gate=(u,id)=>{if(String(id).startsWith('ph:')&&!adultOn(u))throw new E('18+ content is not enabled on this account',403)};
const pub=u=>({id:u.id,display_name:u.display_name,prefs:u.prefs,admin:isAdmin(u),has_dob:!!u.dob,adult_ok:adultOK(u),adult_on:adultOn(u),badge:!!u.badge});
const iph=ip=>mac('ip:'+ip).slice(0,24);   // keyed hash, raw IPs are never stored
const ipBlocked=async ip=>{const r=await S('admin').get('ipban/'+iph(ip),{type:'json'});return!!r&&(!r.until||r.until>Date.now())};
async function limit(kind,ip,max,secs){const s=S('ratelimit'),k=`${kind}/${ip}/${Math.floor(Date.now()/1e3/secs)}`;const n=(await s.get(k,{type:'json'}))||0;if(n>=max)throw new E('Too many requests, slow down',429);await s.setJSON(k,n+1)}

/* ---- video helpers ---- */
const okHost=u=>{try{const x=new URL(u);return x.protocol==='https:'&&/(^|\.)(archive\.org|wikimedia\.org|ytimg\.com|youtube\.com|pornhub\.com|phncdn\.com)$/.test(x.hostname)}catch{return false}};
const cleanVideo=o=>{const s=(k,n=200)=>String(o?.[k]??'').slice(0,n);
  const v={id:s('id'),kind:s('kind',5),src:s('src',500),title:s('title'),creator:s('creator',100),cid:s('cid',100),source:s('source',20),page:s('page',500),poster:s('poster',500)};
  const ok=ID.test(v.id)&&['youtube','commons','archive','pornhub'].includes(v.source)&&okHost(v.page)&&(!v.poster||okHost(v.poster))&&
    (v.kind==='yt'?/^[\w-]{11}$/.test(v.src):v.kind==='embed'?v.source==='pornhub'&&/^\w{6,40}$/.test(v.src)&&v.id==='ph:'+v.src:v.kind==='file'&&okHost(v.src));
  if(!ok)throw new E('Invalid video');
  return v};
const bump=async(id,fn)=>{const s=S('videos'),k='v/'+h(id);const d=(await s.get(k,{type:'json'}))||{likes:0,views:0,comments:0,reports:0};fn(d);await s.setJSON(k,d);return d};
const statsFor=async ids=>Object.fromEntries(await Promise.all(ids.map(async id=>[id,(await S('videos').get('v/'+h(id),{type:'json'}))||{likes:0,views:0,comments:0}])));
const decorate=(v,st,u)=>({...v,likes:st.likes,views:st.views,comments:st.comments,liked:!!u?.likes.includes(v.id),saved:!!u?.saves.some(x=>x.id===v.id),following:!!u?.follows.some(f=>f.source===v.source&&f.cid===v.cid)});
const vidId=b=>{if(!ID.test(String(b.id)))throw new E('Invalid video id');return b.id};

/* ---- sources ---- */
async function commons({q,user}={}){
  const base='https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=videoinfo&viiprop=url|user|mime|size|derivatives&viiurlwidth=480';
  const sel=user?`&generator=allimages&gaiuser=${enc(user)}&gaimime=video/webm&gailimit=20`:`&generator=search&gsrnamespace=6&gsrlimit=20&gsroffset=${rnd(60)}&gsrsearch=${enc('filetype:video '+q+' -nude -sex -porn -erotic')}`;
  const d=await J(base+sel);
  return Object.values(d.query?.pages||{}).map(p=>{
    const i=p.videoinfo?.[0];if(!i)return null;const D=i.derivatives||[];
    const dv=D.find(x=>x.transcodekey==='480p.mp4')||D.find(x=>x.transcodekey==='360p.mp4')||D.find(x=>/\.mp4$/.test(x.transcodekey||''))||D.find(x=>/webm/.test(x.type||''));
    const src=dv?.src||(/webm|ogg|mp4/.test(i.mime||'')&&i.size<60e6?i.url:null);if(!src)return null;
    return{id:'commons:'+p.pageid,kind:'file',src,title:p.title.replace(/^File:/,'').replace(/\.\w+$/,'').replace(/[_-]+/g,' '),creator:i.user||'Wikimedia',cid:i.user||'Wikimedia',source:'commons',page:i.descriptionurl,poster:i.thumburl||''}}).filter(Boolean);
}
async function archive({q,creator,sort}={}){
  const qq=creator?`creator:"${creator.replace(/["\\]/g,'')}" AND mediatype:movies`:`${q?`(${q}) AND `:''}mediatype:movies AND licenseurl:(*creativecommons* OR *publicdomain*) AND NOT subject:(adult OR nsfw OR erotic)`;
  const d=await J(`https://archive.org/advancedsearch.php?q=${enc(qq)}&fl[]=identifier&fl[]=title&fl[]=creator&rows=12&page=${1+rnd(sort?4:8)}&output=json${sort?'&sort[]=downloads+desc':''}`);
  const out=await Promise.all((d.response?.docs||[]).slice(0,8).map(async x=>{try{
    const m=await J('https://archive.org/metadata/'+enc(x.identifier));
    const f=(m.files||[]).find(f=>/\.mp4$/i.test(f.name)&&+f.size<80e6);if(!f)return null;
    const c=String([].concat(x.creator||'Internet Archive')[0]).slice(0,100);
    return{id:'archive:'+x.identifier,kind:'file',src:`https://archive.org/download/${enc(x.identifier)}/${f.name.split('/').map(enc).join('/')}`,title:String([].concat(x.title||x.identifier)[0]),creator:c,cid:c,source:'archive',page:'https://archive.org/details/'+enc(x.identifier),poster:'https://archive.org/services/img/'+enc(x.identifier)}}catch{return null}}));
  return out.filter(Boolean);
}
async function youtube({q,cat,channel,popular,lang}){
  let u;
  if(popular)u=`https://www.googleapis.com/youtube/v3/videos?part=snippet,status&chart=mostPopular&maxResults=30&regionCode=${lang.slice(3)}&key=${YT}`;
  else{const before=new Date(Date.now()-rnd(8*365)*864e5).toISOString();
    u=`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&videoSyndicated=true&videoDuration=short&safeSearch=strict&maxResults=15&relevanceLanguage=${lang.slice(0,2)}&publishedBefore=${before}&key=${YT}`+(channel?`&channelId=${enc(channel)}`:`&q=${enc(q)}`+(YTCAT[cat]?`&videoCategoryId=${YTCAT[cat]}`:''))}
  const d=await J(u);
  return(d.items||[]).filter(v=>!v.status||v.status.embeddable).map(v=>{const id=v.id.videoId||v.id;
    return{id:'yt:'+id,kind:'yt',src:id,title:dec(v.snippet.title),creator:dec(v.snippet.channelTitle),cid:v.snippet.channelId,source:'youtube',page:'https://www.youtube.com/watch?v='+id,poster:v.snippet.thumbnails?.high?.url||''}});
}

// Defensive title/tag filter for the 18+ feed: drops anything that sounds youth-coded. Edit to taste.
const PH_BLOCK=/\b(child|children|kid|kids|minor|minors|underage|under age|loli|lolita|shota|preteen|pre-teen|toddler|baby|babysit\w*|jailbait|school ?girl|school ?boy|teen|teens|teenage\w*|barely legal|young)\b/i;
async function phub(){
  const ord=pick(['mostviewed','rating','newest','featured']),p=new URLSearchParams({thumbsize:'large_hd',ordering:ord,page:String(1+rnd(ord==='newest'?5:25))});
  if(ord==='mostviewed'||ord==='rating')p.set('period',pick(['weekly','monthly','alltime']));
  const d=await J('https://www.pornhub.com/webmasters/search?'+p);
  return(d.videos||[]).map(x=>x.video||x).map(v=>{
    const key=String(v.video_id||''),txt=[v.title,...(v.tags||[]).map(t=>t.tag_name||t),...(v.categories||[]).map(c=>c.category||c)].join(' ');
    if(!/^\w{6,40}$/.test(key)||PH_BLOCK.test(txt))return null;
    const star=String(v.pornstars?.[0]?.pornstar_name||v.pornstars?.[0]||'Pornhub').slice(0,100),poster=v.default_thumb||v.thumb||'';
    return{id:'ph:'+key,kind:'embed',src:key,title:dec(String(v.title||'Untitled')).slice(0,200),creator:star,cid:star,source:'pornhub',page:'https://www.pornhub.com/view_video.php?viewkey='+key,poster:okHost(poster)?poster:''}}).filter(Boolean);
}

/* ---- routes ---- */
const R={
'POST /register':async({body,ip})=>{
  if(!SECRET)throw new E('Server is missing JWT_SECRET',500);await limit('auth',ip,20,3600);
  if(await ipBlocked(ip))throw new E('Sign-ups are blocked from your network',403);
  const{email,password,birthday}=body;
  if(typeof email!=='string'||!/^\S+@\S+\.\S+$/.test(email)||email.length>120||typeof password!=='string'||password.length<8||password.length>100)throw new E('Enter a valid email and a password of 8+ characters');
  if(!validDob(birthday))throw new E('Enter your date of birth');if(ageOf(birthday)<13)throw new E('You must be at least 13 to create an account');
  const e=email.toLowerCase(),us=S('users');
  if(await us.get('e/'+e))throw new E('That email is already registered',409);
  let id;do{id='User_'+crypto.randomInt(100000,1000000)}while(await us.get('u/'+id));
  const salt=crypto.randomBytes(16).toString('hex');
  const u={id,email:e,dob:birthday,ip:iph(ip),salt,pass:hashpw(password,salt),display_name:id,prefs:{},likes:[],saves:[],follows:[],seen:[],ncomments:0,created:Date.now()};
  await us.setJSON('u/'+id,u);await us.setJSON('e/'+e,{id});
  return{token:sign(id),user:pub(u)}},
'POST /login':async({body,ip})=>{
  if(!SECRET)throw new E('Server is missing JWT_SECRET',500);await limit('auth',ip,20,3600);
  const l=String(body.login||'').trim(),us=S('users');
  const id=/^User_\d+$/.test(l)?l:(await us.get('e/'+l.toLowerCase(),{type:'json'}))?.id;
  const u=id&&await getUser(id);
  if(!u||typeof body.password!=='string'||!crypto.timingSafeEqual(Buffer.from(hashpw(body.password,u.salt)),Buffer.from(u.pass)))throw new E('Wrong ID/email or password',401);
  if(isBanned(u))throw new E(banMsg(u),403);
  if(u.ip!==iph(ip)){u.ip=iph(ip);await putUser(u)}
  return{token:sign(u.id),user:pub(u)}},
'GET /me':async({uid})=>{const u=await needUser(uid),notice=u.notice;if(notice){delete u.notice;await putUser(u)}return{user:pub(u),notice}},
'PUT /me':async({uid,body})=>{const u=await needUser(uid);
  if(body.display_name!==undefined){const n=String(body.display_name).trim().replace(/\s+/g,' ');if(!n||n.length>30||STRONG.test(n))throw new E('Display name must be 1–30 clean characters');u.display_name=n}
  if(body.prefs!==undefined){if(!body.prefs||typeof body.prefs!=='object'||Array.isArray(body.prefs)||JSON.stringify(body.prefs).length>2000)throw new E('Invalid preferences');u.prefs=body.prefs}
  if(body.birthday!==undefined){if(u.dob)throw new E('Birthday is already set. Ask an admin to reset it.',409);if(!validDob(body.birthday))throw new E('Enter a valid date of birth');u.dob=body.birthday;if(ageOf(u.dob)<18)u.adult_on=false}
  if(body.adult!==undefined){if(body.adult){if(!adultOK(u))throw new E('You must be 18 or older, with your birthday set, to turn this on',403);u.adult_on=true;u.adult_ack=Date.now()}else u.adult_on=false}
  await putUser(u);return{user:pub(u)}},
'DELETE /me':async({uid})=>{const u=await needUser(uid),C=S('comments');
  for(const{key}of(await C.list()).blobs){const d=await C.get(key,{type:'json'}),f=d.filter(c=>c.uid!==u.id);if(f.length!==d.length)await C.setJSON(key,f)}
  await S('users').delete('u/'+u.id);await S('users').delete('e/'+u.email);return{ok:true}},
'DELETE /history':async({uid})=>{const u=await needUser(uid);u.seen=[];await putUser(u);return{ok:true}},
'GET /profile':async({uid})=>{const u=await needUser(uid),b=u.boost||{};return{likes:u.likes.length+(b.likes||0),saves:u.saves.length,comments:u.ncomments||0,following:u.follows,following_count:u.follows.length+(b.following||0),followers:b.followers||0,uploads:(u.uploads||[]).length}},
'GET /uploads':async({uid})=>{const u=await needUser(uid),list=[...(u.uploads||[])].reverse(),st=await statsFor(list.map(v=>v.id));return{videos:list.map(v=>decorate(v,st[v.id],u))}},

'GET /feed':async({url,uid})=>{
  const q=url.searchParams,mode=['random','trending','following','adult'].includes(q.get('mode'))?q.get('mode'):'random';
  const lang=LANGS.includes(q.get('lang'))?q.get('lang'):'en-US',user=await getUser(uid);
  const seen=new Set([...(q.get('seen')||'').split(',').slice(0,300),...(user?.seen||[])]);
  let cats=(q.get('cats')||'').split(',').filter(c=>TOPICS[c]);if(!cats.length)cats=Object.keys(TOPICS);
  const jobs=[];
  if(mode==='adult'){if(!adultOn(user))throw new E('18+ content is not enabled on this account',403);jobs.push(phub())}
  else if(mode==='following'){if(!user)throw new E('Log in to see creators you follow',401);
    for(const f of shuffle(user.follows).slice(0,4))jobs.push(f.source==='youtube'?(YT&&youtube({channel:f.cid,lang})):f.source==='archive'?archive({creator:f.cid}):commons({user:f.cid}))}
  else if(mode==='trending')jobs.push(YT&&youtube({popular:1,lang}),archive({sort:1}));
  else{const cat=pick(cats),t=pick(TOPICS[cat]);jobs.push(commons({q:t}),archive({q:t}),YT&&youtube({q:t,cat,lang}))}
  const errs=[],res=(await Promise.allSettled(jobs.filter(Boolean))).flatMap(r=>r.status==='fulfilled'?r.value:(errs.push(r.reason?.message),[]));
  if(!res.length&&errs.length)throw new E('Could not load videos: '+errs[0],502);
  const ids=new Set(),vids=shuffle(res).filter(v=>ID.test(v.id)&&!seen.has(v.id)&&(mode==='adult'||!BAD.test(v.title))&&!ids.has(v.id)&&ids.add(v.id)).slice(0,10);
  const st=await statsFor(vids.map(v=>v.id));
  return{videos:vids.filter(v=>!st[v.id].blocked).map(v=>decorate(v,st[v.id],user))}},
'GET /saved':async({uid})=>{const u=await needUser(uid),list=[...u.saves].filter(v=>!v.id.startsWith('ph:')||adultOn(u)).reverse(),st=await statsFor(list.map(v=>v.id));return{videos:list.map(v=>decorate(v,st[v.id],u))}},

'POST /view':async({uid,body})=>{const id=vidId(body),u=await getUser(uid),g=gate(u,id);let count=true;
  if(u){if(u.seen.includes(id))count=false;else{u.seen=[...u.seen.slice(-499),id];await putUser(u)}}
  if(count)await bump(id,d=>d.views++);return{ok:true}},
'POST /like':async({uid,body})=>{const u=await needUser(uid),id=vidId(body),g=gate(u,id),on=!u.likes.includes(id);
  u.likes=on?[...u.likes,id]:u.likes.filter(x=>x!==id);await putUser(u);
  const d=await bump(id,d=>{d.likes=Math.max(0,d.likes+(on?1:-1))});return{on,count:d.likes}},
'POST /save':async({uid,body})=>{const u=await needUser(uid),id=vidId(body.video||{}),g=gate(u,id),has=u.saves.some(s=>s.id===id);
  if(has)u.saves=u.saves.filter(s=>s.id!==id);else{if(u.saves.length>=200)throw new E('Favorites are full (200)');u.saves.push(cleanVideo(body.video))}
  await putUser(u);return{on:!has}},
'POST /follow':async({uid,body})=>{const u=await needUser(uid),f={name:String(body.name||'').slice(0,100),source:String(body.source||''),cid:String(body.cid||'').slice(0,100)};
  if(!f.cid||!['youtube','commons','archive'].includes(f.source))throw new E('Invalid creator');
  const has=u.follows.some(x=>x.source===f.source&&x.cid===f.cid);
  u.follows=has?u.follows.filter(x=>!(x.source===f.source&&x.cid===f.cid)):[...u.follows.slice(-199),f];await putUser(u);return{on:!has}},
'POST /report':async({uid,body})=>{const u=await needUser(uid),id=vidId(body);gate(u,id);
  const RP=S('reports'),k=`${h(id)}/${u.id}`;if(await RP.get(k))return{ok:true};
  const reason=['Spam or scam','Sexual content','Violence or gore','Hate or harassment','Other'].includes(body.reason)?body.reason:'Other';
  let meta={};try{const c=cleanVideo({...body.video,id});meta={title:c.title,creator:c.creator,source:c.source}}catch{}
  await RP.setJSON(k,{id,t:Date.now(),reason});await bump(id,d=>{d.reports=(d.reports||0)+1});
  const A=S('admin'),ix=(await A.get('reported',{type:'json'}))||{},e=ix[h(id)]||{id,count:0,reasons:{}};Object.assign(e,meta);e.reasons=e.reasons||{};e.reasons[reason]=(e.reasons[reason]||0)+1;e.count++;e.t=Date.now();ix[h(id)]=e;await A.setJSON('reported',ix);return{ok:true}},

'GET /comments':async({url,uid})=>{const id=vidId({id:url.searchParams.get('id')}),u=await getUser(uid),adult=u?.prefs.maturity==='adult';gate(u,id);
  const d=(await S('comments').get('c/'+h(id),{type:'json'}))||[];
  return{comments:d.filter(c=>!c.hidden).map(c=>({id:c.id,parent_id:c.parent,name:c.name,created:c.created,text:adult?c.text:c.text.replace(MILD,'***')}))}},
'POST /comments':async({uid,body,ip})=>{await limit('cmt',ip,8,60);const u=await needUser(uid),id=vidId(body);gate(u,id);
  const text=String(body.text||'').trim().replace(/\s+/g,' ');
  if(!text||text.length>300)throw new E('Comment must be 1–300 characters');if(STRONG.test(text))throw new E('Comment blocked by moderation',422);
  const C=S('comments'),k='c/'+h(id),d=(await C.get(k,{type:'json'}))||[],parent=body.parent?+body.parent:null;
  if(parent&&!d.some(c=>c.id===parent))throw new E('Parent comment not found');
  d.push({id:Math.max(0,...d.map(c=>c.id))+1,parent,uid:u.id,name:u.display_name,text,created:Math.floor(Date.now()/1e3),reports:[],hidden:false});
  await C.setJSON(k,d.slice(-500));u.ncomments=(u.ncomments||0)+1;await putUser(u);
  await bump(id,x=>{x.comments=d.filter(c=>!c.hidden).length});return{ok:true}},
'POST /comments/report':async({uid,body})=>{const u=await needUser(uid),id=vidId(body),g=gate(u,id),C=S('comments'),k='c/'+h(id),d=(await C.get(k,{type:'json'}))||[],c=d.find(x=>x.id===+body.cid);
  if(!c)throw new E('Not found',404);if(!c.reports.includes(u.id))c.reports.push(u.id);if(c.reports.length>=3)c.hidden=true;await C.setJSON(k,d);return{ok:true}},

/* ---- admin / moderation (every route re-checks ADMIN_IDS on the server) ---- */
'GET /admin/overview':async({uid})=>{await needAdmin(uid);const A=S('admin'),bans=(await A.get('bans',{type:'json'}))||{},rep=(await A.get('reported',{type:'json'}))||{};
  return{users:(await S('users').list({prefix:'u/'})).blobs.length,banned:Object.values(bans).filter(b=>!b.until||b.until>Date.now()).length,reported:Object.values(rep).filter(r=>!r.blocked).length}},
'GET /admin/users':async({uid,url})=>{await needAdmin(uid);
  const q=(url.searchParams.get('q')||'').trim().slice(0,120),L=q.toLowerCase(),off=Math.max(0,+url.searchParams.get('off')||0);let ids;
  if(url.searchParams.get('banned')==='1'){const ix=(await S('admin').get('bans',{type:'json'}))||{};ids=Object.entries(ix).filter(([,b])=>!b.until||b.until>Date.now()).map(([id])=>id)}
  else{
    if(q.includes('@')){const r=await S('users').get('e/'+L,{type:'json'});if(r)ids=[r.id]}
    if(!ids){const all=(await S('users').list({prefix:'u/'})).blobs.map(b=>b.key.slice(2));ids=q?all.filter(i=>i.toLowerCase().startsWith(L)):all;
      if(q&&!ids.length)ids=(await Promise.all(all.slice(0,400).map(getUser))).filter(u=>u&&(u.display_name.toLowerCase().includes(L)||String(u.email).includes(L))).map(u=>u.id)}}
  const page=ids.slice(off,off+25),users=(await Promise.all(page.map(getUser))).filter(Boolean).map(u=>({id:u.id,email:u.email,display_name:u.display_name,created:u.created,admin:isAdmin(u),adult_on:adultOn(u),
    age_group:u.dob?(ageOf(u.dob)>=18?'18+':'under 18'):null,ban:isBanned(u)?u.ban:null,badge:!!u.badge,boost:u.boost||{},uploads:(u.uploads||[]).length}));
  return{users,total:ids.length,next:off+25<ids.length?off+25:null}},
'POST /admin/ban':async({uid,body})=>{const a=await needAdmin(uid);if(!/^User_\d+$/.test(String(body.id)))throw new E('Invalid user id');
  const t=await getUser(body.id);if(!t)throw new E('User not found',404);if(isAdmin(t))throw new E('Admins cannot be banned',403);
  const days=Math.max(0,Math.min(3650,+body.days||0)),until=days?Date.now()+days*864e5:0;
  t.ban={reason:String(body.reason||'').slice(0,200),by:a.id,t:Date.now(),until};
  let ip=false;if(body.ip&&t.ip){await S('admin').setJSON('ipban/'+t.ip,{id:t.id,t:Date.now(),until});ip=true}
  await putUser(t);await banIndex(t.id,t.ban);return{ok:true,ip}},
'POST /admin/unban':async({uid,body})=>{await needAdmin(uid);const t=await getUser(String(body.id));if(!t)throw new E('User not found',404);
  delete t.ban;await putUser(t);await banIndex(t.id,null);if(t.ip)await S('admin').delete('ipban/'+t.ip);return{ok:true}},
'POST /admin/reset-birthday':async({uid,body})=>{await needAdmin(uid);const t=await getUser(String(body.id));if(!t)throw new E('User not found',404);delete t.dob;t.adult_on=false;await putUser(t);return{ok:true}},
'POST /admin/troll':async({uid,body})=>{await needAdmin(uid);const t=await getUser(String(body.id));if(!t)throw new E('User not found',404);
  const n=x=>Math.max(-1e9,Math.min(1e9,Math.trunc(+x||0)));if(body.reset)t.boost={};const b=t.boost=t.boost||{};
  for(const k of['followers','following','likes'])if(n(body[k]))b[k]=Math.max(0,Math.min(1e9,(b[k]||0)+n(body[k])));
  if(body.badge!==undefined)t.badge=!!body.badge;
  const nm=String(body.name||'').trim().replace(/\s+/g,' ').slice(0,30);if(nm)t.display_name=nm;
  const nt=String(body.notice||'').trim().slice(0,200);if(nt)t.notice=nt;
  await putUser(t);return{ok:true,boost:b}},
'POST /admin/fake-upload':async({uid,body})=>{await needAdmin(uid);const t=await getUser(String(body.id));if(!t)throw new E('User not found',404);
  const count=Math.max(1,Math.min(5,+body.count||1)),cat=pick(Object.keys(TOPICS)),topic=pick(TOPICS[cat]);
  const jobs=[commons({q:topic}),archive({q:topic}),YT&&youtube({q:topic,cat,lang:'en-US'})].filter(Boolean);
  const pool=shuffle((await Promise.allSettled(jobs)).flatMap(r=>r.status==='fulfilled'?r.value:[])).filter(v=>ID.test(v.id)&&!BAD.test(v.title));
  const have=new Set((t.uploads||[]).map(v=>v.id)),added=[];
  for(const v of pool){if(added.length>=count)break;if(have.has(v.id))continue;
    try{const c={...cleanVideo(v),creator:t.display_name.slice(0,100),cid:t.id};added.push(c);have.add(c.id);await bump(c.id,d=>{d.views+=500+rnd(50000);d.likes+=10+rnd(3000)})}catch{}}
  if(!added.length)throw new E('Could not fetch a video right now, try again',502);
  t.uploads=[...(t.uploads||[]),...added].slice(-50);await putUser(t);return{ok:true,added:added.length}},
'GET /admin/reports':async({uid})=>{await needAdmin(uid);const ix=(await S('admin').get('reported',{type:'json'}))||{};return{reports:Object.values(ix).sort((a,b)=>b.t-a.t).slice(0,100)}},
'POST /admin/video':async({uid,body})=>{await needAdmin(uid);const id=vidId(body),A=S('admin'),ix=(await A.get('reported',{type:'json'}))||{},k=h(id),a=body.action;
  if(a==='block'||a==='unblock'){await bump(id,d=>{d.blocked=a==='block'});ix[k]={...(ix[k]||{id,count:0,t:Date.now()}),blocked:a==='block'}}
  else if(a==='dismiss'){await bump(id,d=>{d.reports=0});delete ix[k]}
  else throw new E('Bad action');
  await A.setJSON('reported',ix);return{ok:true}},
'GET /admin/comments':async({uid})=>{await needAdmin(uid);const C=S('comments'),out=[];
  for(const{key}of(await C.list()).blobs.slice(0,300)){const d=(await C.get(key,{type:'json'}))||[];for(const c of d)if(c.hidden||c.reports?.length)out.push({key,cid:c.id,uid:c.uid,name:c.name,text:c.text,reports:c.reports?.length||0,hidden:!!c.hidden,created:c.created})}
  return{comments:out.sort((a,b)=>b.reports-a.reports).slice(0,100)}},
'POST /admin/comment':async({uid,body})=>{await needAdmin(uid);if(!/^c\/[0-9a-f]{24}$/.test(String(body.key)))throw new E('Invalid key');
  const C=S('comments'),d=(await C.get(body.key,{type:'json'}))||[],i=d.findIndex(c=>c.id===+body.cid);if(i<0)throw new E('Not found',404);const a=body.action;
  if(a==='delete')d.splice(i,1);else if(a==='hide')d[i].hidden=true;else if(a==='show'){d[i].hidden=false;d[i].reports=[]}else throw new E('Bad action');
  await C.setJSON(body.key,d);return{ok:true}},
};

export default async(req,ctx)=>{
  try{
    const url=new URL(req.url),fn=R[req.method+' '+url.pathname.replace(/^\/api/,'')];
    if(!fn)throw new E('Not found',404);
    let body={};
    if(req.method==='POST'||req.method==='PUT'){const t=await req.text();if(t.length>20000)throw new E('Request too large',413);try{body=JSON.parse(t||'{}')}catch{throw new E('Bad JSON')}}
    const uid=verify((req.headers.get('authorization')||'').slice(7));
    if(uid){const me=await getUser(uid);if(isBanned(me))throw new E(banMsg(me),403,{banned:true})}
    return j(await fn({url,body,uid,ip:ctx.ip||'unknown'}));
  }catch(e){if(e instanceof E)return j({error:e.message,...e.x},e.c);console.error(e);return j({error:'Server error'},500)}
};
export const config={path:'/api/*'};
