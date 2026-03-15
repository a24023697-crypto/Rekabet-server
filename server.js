const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const cors = require('cors');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ─────────────────────────────────────────────
//  VERİ DEPOSU
// ─────────────────────────────────────────────
const players     = new Map();   // username -> playerObj
const clans       = new Map();   // clanName -> {name, leader, members[]}
const clanChat    = {};          // clanName -> [{user,text,avatar,ts}]
const globalChat  = [];          // [{user,text,avatar,clan,ts}]

// ─────────────────────────────────────────────
//  NPC OYUNCULAR  (sıralama boş görünmesin)
// ─────────────────────────────────────────────
const NPC_ISIMLER = [
  'KralFerhat','YıldızAvcısı','BoncukUstası','TaşKıran','KomboKral',
  'SüperHamle','ElmasHunter','AltınEfendi','RoketAtıcı','BombacıBey',
  'ÇiçekKıran','KayanYıldız','DevirTopu','KasımPaşa','GündüzAvcısı',
  'MaçKraliçesi','TurboFerdi','UçanBoncuk','GümüşKale','KılıçUstası',
];
const NPC_KLANLAR = ['EfsaneKlan','YıldızTakımı','KrallarKlanı','BoncukBirliği',''];
const NPC_AVATARLAR = ['👤','🧑','🧙','⚔️','👑','🔥'];

let npcler = NPC_ISIMLER.map((isim, i) => ({
  username : isim,
  score    : Math.floor(500 + Math.random() * 14000),
  level    : Math.floor(1 + Math.random() * 14),
  clan     : NPC_KLANLAR[i % NPC_KLANLAR.length],
  avatar   : NPC_AVATARLAR[Math.floor(Math.random() * NPC_AVATARLAR.length)],
  isNpc    : true,
}));

// Her 90 saniyede NPC skorları biraz değişsin — canlı görünsün
setInterval(() => {
  npcler = npcler.map(n => ({
    ...n,
    score: Math.max(100, n.score + Math.floor((Math.random() - 0.38) * 700)),
  }));
  herkeseBildir({ type: 'lb_update' });
}, 90 * 1000);

// ─────────────────────────────────────────────
//  YARDIMCI FONKSİYONLAR
// ─────────────────────────────────────────────
function temizle(p) {
  const { ws, ...rest } = p;
  return rest;
}

function liderListesi() {
  const gercek = [...players.values()].map(temizle);
  return [...gercek, ...npcler]
    .sort((a, b) => b.score - a.score)
    .slice(0, 50);
}

function klanListesi() {
  const map = new Map();
  [...players.values(), ...npcler].forEach(p => {
    if (!p.clan) return;
    const k = map.get(p.clan) || { name: p.clan, score: 0, members: 0 };
    k.score += p.score;
    k.members++;
    map.set(p.clan, k);
  });
  return [...map.values()].sort((a, b) => b.score - a.score);
}

function klanUyeleri(klanAdi) {
  const gercek = [...players.values()]
    .filter(p => p.clan === klanAdi)
    .map(p => ({ username: p.username, score: p.score, level: p.level, avatar: p.avatar, isNpc: false }));
  const npc = npcler
    .filter(n => n.clan === klanAdi)
    .map(n => ({ username: n.username, score: n.score, level: n.level, avatar: n.avatar, isNpc: true }));
  return [...gercek, ...npc].sort((a, b) => b.score - a.score);
}

function herkeseBildir(mesaj, haric = null) {
  const veri = JSON.stringify(mesaj);
  wss.clients.forEach(ws => {
    if (ws !== haric && ws.readyState === 1) ws.send(veri);
  });
}

function klanaGonder(klanAdi, mesaj, haric = null) {
  const veri = JSON.stringify(mesaj);
  players.forEach(p => {
    if (p.clan === klanAdi && p.ws !== haric && p.ws?.readyState === 1) {
      p.ws.send(veri);
    }
  });
}

function gonder(ws, mesaj) {
  if (ws?.readyState === 1) ws.send(JSON.stringify(mesaj));
}

// ─────────────────────────────────────────────
//  WEBSOCKET BAĞLANTILARI
// ─────────────────────────────────────────────
wss.on('connection', ws => {
  let benimKullanici = null;

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    // ── KAYIT / GİRİŞ ──────────────────────────────────────
    if (m.type === 'register') {
      const { username, score = 0, level = 1, clan = '', avatar = '👤' } = m;
      if (!username) return;
      benimKullanici = username;

      const eskiVeri = players.get(username) || {};
      const oyuncu = {
        username,
        score  : Math.max(score, eskiVeri.score || 0),
        level  : level  || eskiVeri.level  || 1,
        clan   : clan   || eskiVeri.clan   || '',
        avatar : avatar || eskiVeri.avatar || '👤',
        ws,
        isNpc  : false,
        sonGorus: Date.now(),
      };
      players.set(username, oyuncu);

      // İlk yükleme paketi
      gonder(ws, {
        type        : 'registered',
        player      : temizle(oyuncu),
        leaderboard : liderListesi(),
        clans       : klanListesi(),
        globalChat  : globalChat.slice(-60),
        clanChat    : oyuncu.clan ? (clanChat[oyuncu.clan] || []).slice(-60) : [],
        clanMembers : oyuncu.clan ? klanUyeleri(oyuncu.clan) : [],
      });

      herkeseBildir({ type: 'player_join', username }, ws);
    }

    // ── SKOR GÜNCELLE ───────────────────────────────────────
    else if (m.type === 'score_update') {
      const p = players.get(benimKullanici);
      if (!p) return;
      p.score = Math.max(p.score, m.score || 0);
      p.level = m.level || p.level;
      herkeseBildir({ type: 'lb_update' });
    }

    // ── KLAN KUR / KATIL ────────────────────────────────────
    else if (m.type === 'create_clan' || m.type === 'join_clan') {
      const { clanName } = m;
      if (!clanName || !benimKullanici) return;
      const p = players.get(benimKullanici);
      if (!p) return;

      // Önceki klandan ayrıl
      if (p.clan && p.clan !== clanName) {
        const eskiKlan = clans.get(p.clan);
        if (eskiKlan) eskiKlan.members = eskiKlan.members.filter(x => x !== benimKullanici);
      }

      // Klan yoksa oluştur
      if (!clans.has(clanName)) {
        clans.set(clanName, { name: clanName, leader: benimKullanici, members: [] });
        clanChat[clanName] = [];
      }
      const klan = clans.get(clanName);
      if (!klan.members.includes(benimKullanici)) klan.members.push(benimKullanici);
      p.clan = clanName;

      gonder(ws, {
        type       : 'clan_joined',
        clanName,
        members    : klanUyeleri(clanName),
        clanChat   : (clanChat[clanName] || []).slice(-60),
      });
      klanaGonder(clanName, { type: 'member_joined', username: benimKullanici }, ws);
      herkeseBildir({ type: 'clans_update', clans: klanListesi() });
    }

    // ── KLANDAN AYRIL ───────────────────────────────────────
    else if (m.type === 'leave_clan') {
      const p = players.get(benimKullanici);
      if (!p || !p.clan) return;
      const eskiKlanAdi = p.clan;
      const klan = clans.get(eskiKlanAdi);
      if (klan) klan.members = klan.members.filter(x => x !== benimKullanici);
      p.clan = '';
      gonder(ws, { type: 'clan_left' });
      klanaGonder(eskiKlanAdi, { type: 'member_left', username: benimKullanici });
      herkeseBildir({ type: 'clans_update', clans: klanListesi() });
    }

    // ── GLOBAL SOHBET ───────────────────────────────────────
    else if (m.type === 'global_chat') {
      if (!benimKullanici || !m.text) return;
      const p = players.get(benimKullanici);
      const mesaj = {
        user  : benimKullanici,
        text  : String(m.text).slice(0, 200),
        avatar: p?.avatar || '👤',
        clan  : p?.clan   || '',
        ts    : Date.now(),
      };
      globalChat.push(mesaj);
      if (globalChat.length > 200) globalChat.shift();
      herkeseBildir({ type: 'global_chat', msg: mesaj });
    }

    // ── KLAN SOHBETİ ────────────────────────────────────────
    else if (m.type === 'clan_chat') {
      const p = players.get(benimKullanici);
      if (!p || !p.clan || !m.text) return;
      const mesaj = {
        user  : benimKullanici,
        text  : String(m.text).slice(0, 200),
        avatar: p.avatar || '👤',
        ts    : Date.now(),
      };
      if (!clanChat[p.clan]) clanChat[p.clan] = [];
      clanChat[p.clan].push(mesaj);
      if (clanChat[p.clan].length > 200) clanChat[p.clan].shift();
      klanaGonder(p.clan, { type: 'clan_chat', msg: mesaj });
    }

    // ── LİDERLİK TABLOSu ───────────────────────────────────
    else if (m.type === 'get_leaderboard') {
      gonder(ws, { type: 'leaderboard', data: liderListesi() });
    }

    // ── KLAN ÜYELERİ ────────────────────────────────────────
    else if (m.type === 'get_clan_members') {
      gonder(ws, { type: 'clan_members', clanName: m.clanName, members: klanUyeleri(m.clanName) });
    }
  });

  ws.on('close', () => {
    if (benimKullanici) {
      const p = players.get(benimKullanici);
      if (p) p.ws = null;
      herkeseBildir({ type: 'player_left', username: benimKullanici });
    }
  });
});

// ─────────────────────────────────────────────
//  REST API  (opsiyonel kontrol için)
// ─────────────────────────────────────────────
app.get('/',        (_, res) => res.json({ durum: 'Kral Maç Server 👑', oyuncular: players.size, klanlar: clans.size }));
app.get('/health',  (_, res) => res.json({ ok: true }));
app.get('/lb',      (_, res) => res.json(liderListesi()));
app.get('/klanlar', (_, res) => res.json(klanListesi()));

// ─────────────────────────────────────────────
//  BAŞLAT
// ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`👑 Kral Maç Server — port ${PORT} — hazır!`);
});
