// Listener page: pick a language, subscribe to that one audio track, render captions.
const LK = window.LivekitClient;
const $ = (id) => document.getElementById(id);

let languages = [];
let selected = null;
let room = null;

async function loadConfig() {
  const r = await fetch('/api/config');
  const cfg = await r.json();
  languages = cfg.languages || [];
  if (!cfg.sessionActive) {
    $('sub').innerHTML = '<span class="error">No live session right now. Check back when the speaker starts.</span>';
  }
  renderPicker();
}

function renderPicker() {
  const grid = $('langGrid');
  grid.innerHTML = '';
  for (const l of languages) {
    const b = document.createElement('button');
    b.className = 'lang-btn';
    b.innerHTML = `<div class="native">${l.native}</div><div class="en">${l.name}</div>`;
    b.addEventListener('click', () => {
      selected = l.code;
      [...grid.children].forEach((c) => c.classList.remove('selected'));
      b.classList.add('selected');
      $('listenBtn').disabled = false;
      $('nowLang').textContent = `${l.native} · ${l.name}`;
    });
    grid.appendChild(b);
  }
}

async function getToken(lang) {
  const r = await fetch('/api/listener/token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Could not join');
  return data;
}

function showCaption(text) {
  const el = $('caption');
  el.classList.remove('empty');
  el.textContent = text;
}

async function connect() {
  const { token, url } = await getToken(selected);

  if (room) { try { await room.disconnect(); } catch {} }
  room = new LK.Room({ adaptiveStream: true, dynacast: true });

  // Subscribe ONLY to our language's track to save bandwidth.
  room.on(LK.RoomEvent.TrackPublished, (pub) => {
    if (pub.trackName === selected) pub.setSubscribed(true);
  });
  room.on(LK.RoomEvent.TrackSubscribed, (track, pub) => {
    if (track.kind === LK.Track.Kind.Audio && pub.trackName === selected) {
      track.attach($('audio'));
      $('playState').textContent = 'Live';
      tryPlay();
    }
  });
  room.on(LK.RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
    if (topic && topic !== `caption:${selected}`) return;
    try {
      const msg = JSON.parse(new TextDecoder().decode(payload));
      if (msg.type === 'caption' && msg.lang === selected) showCaption(msg.text);
    } catch {}
  });
  room.on(LK.RoomEvent.Disconnected, () => { $('playState').textContent = 'Disconnected — reconnecting…'; });

  await room.connect(url, token, { autoSubscribe: false });

  // Subscribe to any already-published track for our language.
  for (const p of room.remoteParticipants.values()) {
    for (const pub of p.trackPublications.values()) {
      if (pub.trackName === selected) pub.setSubscribed(true);
    }
  }
  $('playState').textContent = 'Connected — waiting for the speaker…';
}

async function tryPlay() {
  const audio = $('audio');
  try {
    await audio.play();
    $('unmuteBtn').style.display = 'none';
  } catch {
    // Autoplay blocked — show an explicit unmute button (mobile browsers).
    $('unmuteBtn').style.display = 'inline-flex';
  }
}

$('listenBtn').addEventListener('click', async () => {
  $('pickError').textContent = '';
  $('listenBtn').disabled = true;
  try {
    $('pickPanel').style.display = 'none';
    $('playPanel').style.display = 'block';
    await connect();
  } catch (e) {
    $('pickError').textContent = e.message;
    $('pickPanel').style.display = 'block';
    $('playPanel').style.display = 'none';
    $('listenBtn').disabled = false;
  }
});

$('changeBtn').addEventListener('click', async () => {
  if (room) { try { await room.disconnect(); } catch {} }
  $('caption').textContent = 'Live captions will appear here as the speaker talks.';
  $('caption').classList.add('empty');
  $('playPanel').style.display = 'none';
  $('pickPanel').style.display = 'block';
  $('listenBtn').disabled = selected ? false : true;
});

$('unmuteBtn').addEventListener('click', () => $('audio').play().then(() => ($('unmuteBtn').style.display = 'none')).catch(() => {}));

loadConfig();
