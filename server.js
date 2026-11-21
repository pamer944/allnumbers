const express = require('express');
const { pool, initDB, getAll, count, exists, add, remove, changeAll, REMOVE_PASSWORD, TIMEZONE } = require('./accounts');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '15mb' }));

app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
});

// ---------------- API ----------------

app.get('/stats', async (req, res) => {
    try {
        res.json({ total: await count() });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/add-account', async (req, res) => {
    try {
        let { phone, password } = req.body || {};

        if (!phone) {
            return res.json({ success: false, error: 'Phone number required.' });
        }
        password = password || '';

        phone = String(phone).trim().replace(/\s+/g, '');
        while (phone.startsWith('0')) phone = phone.substring(1);
        if (!/^\d{9}$/.test(phone)) {
            return res.json({ success: false, error: 'Phone must be 9 digits (no leading 0), e.g. 975232003.' });
        }

        if (await exists(phone)) {
            return res.json({ success: false, error: 'Number already exists.' });
        }

        await add(phone, password);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/add-bulk', async (req, res) => {
    try {
        var phones = (req.body && req.body.phones) || [];
        if (!Array.isArray(phones)) phones = [];

        var added = 0, skipped = 0, invalid = 0;
        var seen = {};

        for (var k = 0; k < phones.length; k++) {
            var p = String(phones[k]).replace(/\D/g, '');
            if (p.indexOf('260') === 0) p = p.slice(3);
            while (p.length > 9 && p.charAt(0) === '0') p = p.slice(1);
            if (!/^\d{9}$/.test(p)) { invalid++; continue; }
            if (seen[p]) continue;
            seen[p] = 1;
            if (await exists(p)) { skipped++; continue; }
            await add(p, '');
            added++;
        }

        res.json({ success: true, added: added, skipped: skipped, invalid: invalid });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ---------------- HANDWRITING OCR via Google Cloud Vision ----------------
app.post('/scan-image', async (req, res) => {
    try {
        var key = process.env.GOOGLE_VISION_API_KEY;
        if (!key) {
            return res.json({ success: false, error: 'Scanner not set up: add GOOGLE_VISION_API_KEY in Railway Variables.' });
        }
        var image = req.body && req.body.image;
        if (!image) return res.json({ success: false, error: 'No image received.' });
        // strip data URL prefix if present
        var comma = image.indexOf('base64,');
        if (comma !== -1) image = image.slice(comma + 7);

        var visionResp = await fetch('https://vision.googleapis.com/v1/images:annotate?key=' + encodeURIComponent(key), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                requests: [{
                    image: { content: image },
                    features: [{ type: 'DOCUMENT_TEXT_DETECTION' }]
                }]
            })
        });
        var data = await visionResp.json();
        if (data.error) {
            return res.json({ success: false, error: 'Vision: ' + data.error.message });
        }
        var r0 = data.responses && data.responses[0];
        if (r0 && r0.error) {
            return res.json({ success: false, error: 'Vision: ' + r0.error.message });
        }
        var text = (r0 && r0.fullTextAnnotation && r0.fullTextAnnotation.text) || '';
        res.json({ success: true, text: text });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

app.post('/remove-account', async (req, res) => {
    try {
        const { phone, pin } = req.body || {};
        if (pin !== REMOVE_PASSWORD) return res.json({ success: false, error: 'Incorrect password.' });
        if (!phone) return res.json({ success: false, error: 'Phone number required.' });
        await remove(phone);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

app.post('/change-all-passwords', async (req, res) => {
    try {
        const { pin, newPassword, oldPassword } = req.body || {};
        if (pin !== REMOVE_PASSWORD) return res.json({ success: false, error: 'Incorrect PIN.' });
        const newPass = (newPassword || '').trim();
        const oldPass = (oldPassword || '').trim();
        if (!newPass) return res.json({ success: false, error: 'New password required.' });
        const updated = await changeAll(oldPass, newPass);
        res.json({ success: true, updated });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ---------------- VIEW ALL ----------------

app.get('/view/all', async (req, res) => {
    try {
        const list = await getAll();

        const rows = list.map((r, i) =>
            `<div class="row" data-phone="${r.phone}">
                <div class="rn">${i + 1}.</div>
                <div class="ri">
                    <div class="rp">${r.phone}</div>
                    <div class="rs">${r.password || ''}</div>
                </div>
                <button class="rb" onclick="store.removeAccount('${r.phone}')">Remove</button>
            </div>`
        ).join('') || '<div class="empty">No numbers yet</div>';

        res.send(`<!DOCTYPE html>
<html>
<head>
<title>All Numbers</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:sans-serif;background:#04060a;padding:20px;min-height:100vh}
.page{background:#0d1117;border-radius:16px;max-width:520px;margin:0 auto;overflow:hidden}
.ph{padding:16px 20px;border-bottom:1px solid #21262d;display:flex;align-items:center;gap:12px}
.back{background:#161b22;border:1px solid #30363d;color:#8b949e;padding:6px 12px;border-radius:8px;font-size:12px;text-decoration:none}
.pt{font-size:15px;font-weight:500;color:#e6edf3}
.ps{font-size:11px;color:#4b5563}
.sw{padding:14px 20px;border-bottom:1px solid #21262d}
.si{width:100%;background:#161b22;border:1px solid #30363d;color:#e6edf3;padding:10px 14px;border-radius:8px;font-size:13px;outline:none}
.row{display:flex;align-items:center;padding:12px 20px;border-bottom:1px solid #161b22;gap:10px}
.row:last-child{border-bottom:none}
.rn{font-size:12px;color:#4b5563;width:34px}
.ri{flex:1}
.rp{font-size:14px;color:#e6edf3;font-weight:500}
.rs{font-size:11px;color:#4b5563;margin-top:2px}
.rb{background:#2d0a0a;border:1px solid #7f1d1d;color:#f87171;padding:4px 10px;border-radius:6px;font-size:11px;cursor:pointer}
.empty{padding:40px;text-align:center;color:#4b5563;font-size:13px}
.hidden{display:none}
.pm{position:fixed;inset:0;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;padding:20px;z-index:100}
.pb{background:#0d1117;border:1.5px solid #21262d;border-radius:16px;padding:28px 24px;width:100%;max-width:320px;text-align:center}
.ptt{font-size:15px;font-weight:500;color:#e6edf3;margin-bottom:6px}
.ps2{font-size:12px;color:#4b5563;margin-bottom:20px}
.pi{width:100%;background:#161b22;border:1px solid #30363d;color:#e6edf3;padding:12px;border-radius:8px;font-size:16px;outline:none;text-align:center;letter-spacing:4px;margin-bottom:14px}
.pr{display:flex;gap:10px}
.pc{flex:1;background:#161b22;border:1px solid #30363d;color:#8b949e;padding:10px;border-radius:8px;font-size:13px;cursor:pointer}
.pco{flex:1;background:#7f1d1d;border:none;color:#f87171;padding:10px;border-radius:8px;font-size:13px;cursor:pointer}
.pe{color:#f87171;font-size:12px;margin-top:10px;display:none}
</style>
</head>
<body>
<div class="page">
<div class="ph">
<a href="/" class="back">&#8592; Back</a>
<div><div class="pt">All Numbers</div><div class="ps">${list.length} total</div></div>
</div>
<div class="sw"><input class="si" placeholder="Search..." oninput="filterRows(this.value)"></div>
<div id="list">${rows}</div>
</div>

<div class="pm" id="modal" style="display:none">
<div class="pb">
<div class="ptt">&#128274; Confirm</div>
<div class="ps2">Enter PIN to remove</div>
<input class="pi" id="pin" type="password" maxlength="10" placeholder="PIN" autocomplete="off">
<div class="pr">
<button class="pc" onclick="closeModal()">Cancel</button>
<button class="pco" id="remove-confirm" onclick="confirmRemove()">Remove</button>
</div>
<div class="pe" id="perr">Incorrect PIN</div>
</div>
</div>

<script>
let pending = null;
let removing = false;

window.store = {
    removeAccount: function(phone) {
        pending = phone;
        const modal = document.getElementById('modal');
        const pin = document.getElementById('pin');
        const error = document.getElementById('perr');
        if (!modal || !pin || !error) return;
        pin.value = '';
        error.style.display = 'none';
        modal.style.display = 'flex';
        setTimeout(function() { pin.focus(); }, 50);
    }
};

function closeModal() {
    pending = null;
    removing = false;
    document.getElementById('modal').style.display = 'none';
    document.getElementById('pin').value = '';
}

async function confirmRemove() {
    if (removing || !pending) return;
    const pin = document.getElementById('pin').value.trim();
    const error = document.getElementById('perr');
    const button = document.getElementById('remove-confirm');

    if (pin !== '1234') {
        error.textContent = 'Incorrect PIN';
        error.style.display = 'block';
        document.getElementById('pin').value = '';
        document.getElementById('pin').focus();
        return;
    }

    removing = true;
    button.textContent = 'Removing...';

    try {
        const response = await fetch('/remove-account', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: pending, pin: pin })
        });
        const result = await response.json();
        if (result.success) {
            const row = Array.from(document.querySelectorAll('.row')).find(r => r.dataset.phone === pending);
            if (row) row.remove();
            closeModal();
        } else {
            error.textContent = result.error || 'Removal failed';
            error.style.display = 'block';
            removing = false;
            button.textContent = 'Remove';
        }
    } catch (e) {
        error.textContent = 'Connection error. Try again.';
        error.style.display = 'block';
        removing = false;
        button.textContent = 'Remove';
    }
}

document.addEventListener('DOMContentLoaded', function() {
    const pin = document.getElementById('pin');
    if (pin) {
        pin.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') confirmRemove();
            if (e.key === 'Escape') closeModal();
        });
    }
});

function filterRows(q) {
    document.querySelectorAll('.row').forEach(r => {
        r.classList.toggle('hidden', q !== '' && !r.dataset.phone.includes(q));
    });
}
</script>
</body>
</html>`);
    } catch (e) {
        res.status(500).send('Error');
    }
});

// ---------------- MAIN DASHBOARD ----------------

app.get('/', async (req, res) => {
    try {
        const total = await count();

        res.send(`<!DOCTYPE html>
<html>
<head>
<title>All Numbers - Total</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:sans-serif;background:#04060a;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.db{background:#080b10;border-radius:20px;padding:24px;width:100%;max-width:520px}
.top-bar{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
.db-title{font-size:18px;font-weight:600;color:#fff}
.pill{padding:6px 14px;border-radius:20px;font-size:11px;font-weight:600;display:flex;align-items:center;gap:6px;background:#0d4429;color:#3fb950}
.dot{width:7px;height:7px;border-radius:50%;animation:blink 1.2s infinite;background:#3fb950}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0.15}}
.total-box{background:#0d1420;border:1.5px solid #30363d;border-radius:16px;padding:28px 20px;margin-bottom:16px;text-align:center}
.tl{font-size:10px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#8b949e;margin-bottom:10px}
.tn{font-size:72px;font-weight:500;line-height:1;letter-spacing:-2px;color:#e6edf3;margin-bottom:6px}
.td{font-size:12px;color:#4b5563;margin-bottom:16px}
.vbtn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:10px 20px;border-radius:8px;font-size:12px;font-weight:600;border:none;background:#92400e;color:#fed7aa;text-decoration:none}
.vcnt{background:#fed7aa;color:#92400e;border-radius:20px;padding:1px 8px;font-size:10px;font-weight:700}
.add-box{background:#0d1117;border:1.5px solid #21262d;border-radius:12px;padding:18px 20px;margin-bottom:16px}
.add-title{font-size:12px;font-weight:600;color:#8b949e;margin-bottom:12px;letter-spacing:0.5px;text-transform:uppercase}
.add-row{display:flex;gap:8px;flex-wrap:wrap}
.add-input{flex:1;min-width:110px;background:#161b22;border:1px solid #30363d;color:#e6edf3;padding:10px 12px;border-radius:8px;font-size:13px;outline:none}
.add-input::placeholder{color:#4b5563}
.add-btn{background:#1a3a6e;border:none;color:#a8d0ff;padding:10px 16px;border-radius:8px;font-size:13px;font-weight:500;cursor:pointer}
.msg{font-size:12px;margin-top:8px;padding:7px 10px;border-radius:6px;display:none}
.msg-ok{background:#0d4429;color:#3fb950}.msg-err{background:#4b1111;color:#f87171}
.footer{display:flex;justify-content:space-between;align-items:center;margin-top:4px}
.tick{font-size:11px;color:#3fb950;font-family:monospace;opacity:0.7}
.hint{font-size:10px;color:#252b35}
.pm{position:fixed;inset:0;background:rgba(0,0,0,0.88);display:flex;align-items:center;justify-content:center;padding:20px;z-index:100}
.pb{background:#0d1117;border:1.5px solid #21262d;border-radius:16px;padding:24px;width:100%;max-width:400px;text-align:center}
.ptt{font-size:15px;font-weight:500;color:#e6edf3;margin-bottom:6px}
.ps2{font-size:12px;color:#8b949e;margin-bottom:14px}
.pr{display:flex;gap:10px}
.pc{flex:1;background:#161b22;border:1px solid #30363d;color:#8b949e;padding:10px;border-radius:8px;font-size:13px;cursor:pointer}
.pco{flex:1;border:none;padding:10px;border-radius:8px;font-size:13px;cursor:pointer}
</style>
</head>
<body>
<div class="db">
<div class="top-bar">
    <div class="db-title">&#128210; All Numbers</div>
    <div class="pill"><div class="dot"></div><span>Live</span></div>
</div>

<div class="total-box">
    <div class="tl">&#8721; Total numbers</div>
    <div class="tn" id="num-total">${total}</div>
    <div class="td">All the numbers you have</div>
    <a href="/view/all" class="vbtn">View all <span class="vcnt" id="cnt-total">${total}</span></a>
</div>

<div class="add-box">
    <div class="add-title">&#43; Add number</div>
    <div class="add-row">
        <input class="add-input" id="inp-phone" placeholder="Phone number (9 digits)" type="text" inputmode="numeric">
        <button class="add-btn" id="add-btn">Add</button>
    </div>
    <div class="msg" id="add-msg"></div>
</div>

<div class="add-box">
    <div class="add-title">&#128203; Add many at once</div>
    <textarea id="bulk-text" placeholder="Paste or type numbers — one per line..." style="width:100%;min-height:90px;resize:vertical;background:#161b22;border:1px solid #30363d;color:#e6edf3;padding:10px 12px;border-radius:8px;font-size:14px;font-family:monospace;outline:none"></textarea>
    <div class="add-row" style="margin-top:8px">
        <button class="add-btn" id="bulk-add-btn">Add all</button>
        <button class="add-btn" id="scan-btn" style="background:#0a3a2a;color:#7fe3b0">&#128247; Scan</button>
        <label class="add-btn" for="photo-input" style="background:#1a2f55;color:#a8d0ff;cursor:pointer">&#128247; Photo</label>
        <input type="file" id="photo-input" accept="image/*" style="display:none">
    </div>
    <div class="msg" id="bulk-msg"></div>
    <div style="font-size:10px;color:#4b5563;margin-top:8px">Scan/Photo fills the box with what it reads &mdash; check and fix any wrong digits, then tap Add all. Handwriting isn't always read perfectly.</div>
</div>

<div class="add-box">
    <div class="add-title">&#128273; Change all passwords</div>
    <div class="add-row">
        <input class="add-input" id="cp-old" placeholder="Current password (blank = all)" type="text">
        <input class="add-input" id="cp-new" placeholder="New password" type="text">
        <input class="add-input" id="cp-pin" placeholder="PIN" type="password" autocomplete="off" style="max-width:110px">
        <button class="add-btn" id="cp-btn">Change</button>
    </div>
    <div class="msg" id="cp-msg"></div>
</div>

<div class="footer">
    <span class="tick" id="tick">--:--:-- CAT</span>
    <span class="hint">Live data &middot; PostgreSQL</span>
</div>
</div>

<div class="pm" id="cam-modal" style="display:none">
  <div class="pb">
    <div class="ptt">&#128247; Scan numbers</div>
    <div class="ps2" id="cam-status">Point the camera at the numbers and tap Capture.</div>
    <video id="cam-video" playsinline autoplay muted style="width:100%;border-radius:10px;background:#000;margin-bottom:12px;display:none"></video>
    <canvas id="cam-canvas" style="display:none"></canvas>
    <div id="cam-results" style="text-align:left;font-size:13px;color:#e6edf3;max-height:160px;overflow:auto;margin-bottom:12px"></div>
    <div class="pr">
      <button class="pc" onclick="closeCamera()">Close</button>
      <button class="pco" id="cam-capture" style="background:#0a3a2a;color:#7fe3b0" onclick="captureNumbers()">Capture</button>
    </div>
  </div>
</div>

<script>
(function() {
    function zambiaTime() {
        return new Date().toLocaleTimeString('en-GB', { timeZone: 'Africa/Lusaka', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    setInterval(function() { document.getElementById('tick').textContent = zambiaTime() + ' CAT'; }, 1000);
    document.getElementById('tick').textContent = zambiaTime() + ' CAT';

    function refreshStats() {
        fetch('/stats').then(r => r.json()).then(d => {
            document.getElementById('num-total').textContent = d.total;
            document.getElementById('cnt-total').textContent = d.total;
        }).catch(function(){});
    }
    setInterval(refreshStats, 2000);
    refreshStats();
    window.refreshStats = refreshStats;

    function showMsg(text, ok) {
        var el = document.getElementById('add-msg');
        el.textContent = text;
        el.className = 'msg ' + (ok ? 'msg-ok' : 'msg-err');
        el.style.display = 'block';
        setTimeout(function() { el.style.display = 'none'; }, 3000);
    }

    document.getElementById('add-btn').addEventListener('click', function() {
        var phone = document.getElementById('inp-phone').value.trim();
        if (!phone) { showMsg('Phone number required', false); return; }

        phone = phone.replace(/\\s+/g, '');
        while (phone.charAt(0) === '0') phone = phone.substring(1);
        if (!/^\\d{9}$/.test(phone)) { showMsg('Phone must be 9 digits (no leading 0), e.g. 975232003', false); return; }

        fetch('/add-account', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: phone })
        })
        .then(r => r.json())
        .then(d => {
            if (d.success) {
                showMsg('Number added', true);
                document.getElementById('inp-phone').value = '';
                refreshStats();
            } else { showMsg(d.error || 'Could not add number', false); }
        })
        .catch(function(){ showMsg('Connection error', false); });
    });

    function showCpMsg(text, ok) {
        var el = document.getElementById('cp-msg');
        el.textContent = text;
        el.className = 'msg ' + (ok ? 'msg-ok' : 'msg-err');
        el.style.display = 'block';
        setTimeout(function() { el.style.display = 'none'; }, 4000);
    }

    document.getElementById('cp-btn').addEventListener('click', function() {
        var oldPassword = document.getElementById('cp-old').value.trim();
        var newPassword = document.getElementById('cp-new').value.trim();
        var pin = document.getElementById('cp-pin').value.trim();
        var btn = document.getElementById('cp-btn');
        if (!newPassword) { showCpMsg('New password required', false); return; }
        if (!pin) { showCpMsg('PIN required', false); return; }
        var scope = oldPassword ? 'all numbers with password "' + oldPassword + '"' : 'ALL numbers';
        if (!confirm('Change password for ' + scope + ' to "' + newPassword + '"?')) return;
        btn.disabled = true; btn.textContent = 'Changing...';
        fetch('/change-all-passwords', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin: pin, oldPassword: oldPassword, newPassword: newPassword })
        })
        .then(function(r){ return r.json(); })
        .then(function(d){
            if (d.success) {
                showCpMsg('Updated ' + d.updated + ' number(s)', true);
                document.getElementById('cp-old').value = '';
                document.getElementById('cp-new').value = '';
                document.getElementById('cp-pin').value = '';
            } else { showCpMsg(d.error || 'Error', false); }
        })
        .catch(function(){ showCpMsg('Network error', false); })
        .then(function(){ btn.disabled = false; btn.textContent = 'Change'; });
    });
})();
</script>

<script>
// ---------------- EXTRACTION ----------------
// Strict: used when SAVING (Add all) - only real 9-digit numbers.
function extractNumbers(text) {
    var out = [], seen = {};
    String(text).split(/[\\r\\n]+/).forEach(function(line) {
        line.split(/\\s{2,}|[,;|\\t]+/).forEach(function(cell) {
            var d = cell.replace(/\\D/g, '');
            if (d.indexOf('260') === 0) d = d.slice(3);
            while (d.length > 9 && d.charAt(0) === '0') d = d.slice(1);
            if (d.length === 9 && !seen[d]) { seen[d] = 1; out.push(d); }
        });
    });
    return out;
}

// Loose: used to FILL the box from a scan - keep every candidate (6-12 digits)
// so NOTHING is dropped; unclear ones get flagged for you to fix.
function extractForBox(text) {
    var out = [], seen = {};
    String(text).split(/[\\r\\n]+/).forEach(function(line) {
        line.split(/\\s{2,}|[,;|\\t]+/).forEach(function(cell) {
            var d = cell.replace(/\\D/g, '');
            if (d.indexOf('260') === 0) d = d.slice(3);
            while (d.length > 12 && d.charAt(0) === '0') d = d.slice(1);
            if (d.length >= 6 && d.length <= 12 && !seen[d]) { seen[d] = 1; out.push(d); }
        });
    });
    return out;
}

function showBulkMsg(text, ok) {
    var el = document.getElementById('bulk-msg');
    el.textContent = text;
    el.className = 'msg ' + (ok ? 'msg-ok' : 'msg-err');
    el.style.display = 'block';
    setTimeout(function() { el.style.display = 'none'; }, 12000);
}

// ---------------- BULK ADD ----------------
document.getElementById('bulk-add-btn').addEventListener('click', async function() {
    var nums = extractNumbers(document.getElementById('bulk-text').value);
    if (nums.length === 0) { showBulkMsg('No clean 9-digit numbers found. Fix the flagged ones first.', false); return; }
    var btn = this, old = btn.textContent;
    btn.disabled = true; btn.textContent = 'Adding ' + nums.length + '...';
    try {
        var resp = await fetch('/add-bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phones: nums })
        });
        var d = await resp.json();
        if (d.success) {
            showBulkMsg('Added ' + d.added + ' - already had ' + d.skipped + (d.invalid ? ' - skipped ' + d.invalid + ' not-9-digit' : ''), true);
            document.getElementById('bulk-text').value = '';
            if (window.refreshStats) window.refreshStats();
        } else { showBulkMsg(d.error || 'Error', false); }
    } catch (e) { showBulkMsg('Network error', false); }
    btn.disabled = false; btn.textContent = old;
});

// ---------------- IMAGE -> SERVER (Google Vision) -> BOX ----------------
// Downscale big photos and return JPEG base64 (smaller upload, faster).
function canvasToBase64(src) {
    var maxSide = Math.max(src.width, src.height) || 1;
    var scale = 2000 / maxSide;
    if (scale > 1) scale = 1;
    var w = Math.max(1, Math.round(src.width * scale));
    var h = Math.max(1, Math.round(src.height * scale));
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(src, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.9);
}

async function scanCanvasIntoBox(canvas) {
    showBulkMsg('Reading the photo... please wait a few seconds.', true);
    var dataUrl;
    try { dataUrl = canvasToBase64(canvas); }
    catch (e) { showBulkMsg('Could not process that image.', false); return 0; }
    try {
        var resp = await fetch('/scan-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: dataUrl })
        });
        var d = await resp.json();
        if (!d.success) { showBulkMsg(d.error || 'Scan failed.', false); return 0; }
        var cands = extractForBox(d.text || '');
        if (cands.length === 0) {
            showBulkMsg('No numbers found in that photo. Try a clearer, closer shot.', false);
            return 0;
        }
        var box = document.getElementById('bulk-text');
        var startPos = box.value.trim() ? box.value.trim().split(/\\n/).length : 0;
        var lines = [], unclear = [];
        cands.forEach(function(d2, i) {
            var pos = startPos + i + 1;
            if (d2.length === 9) {
                lines.push(d2);
            } else {
                var end = d2.slice(-2);
                lines.push(d2 + '   <-- #' + pos + ' NOT CLEAR, ' + d2.length + ' digits, need 9');
                unclear.push('#' + pos + ' (ends ' + end + ', ' + d2.length + ' digits)');
            }
        });
        var existing = box.value.trim();
        box.value = (existing ? existing + '\\n' : '') + lines.join('\\n');
        var clean = cands.length - unclear.length;
        if (unclear.length === 0) {
            showBulkMsg('Read ' + cands.length + ' numbers, all clean (9 digits). Check them, then Add all.', true);
        } else {
            showBulkMsg('Read ' + cands.length + ': ' + clean + ' clean. CHECK -> ' + unclear.join('  |  ') + '. Each is marked in the box - fix then Add all.', false);
        }
        return cands.length;
    } catch (e) {
        showBulkMsg('Network error talking to scanner.', false);
        return 0;
    }
}

// ---------------- PHOTO UPLOAD ----------------
document.getElementById('photo-input').addEventListener('change', function(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) { return; }
    showBulkMsg('Opening photo...', true);
    var img = new Image();
    img.onload = async function() {
        var c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        await scanCanvasIntoBox(c);
        URL.revokeObjectURL(img.src);
    };
    img.onerror = function() { showBulkMsg('Could not open that photo. Try another.', false); };
    img.src = URL.createObjectURL(file);
    e.target.value = '';
});

// ---------------- LIVE CAMERA ----------------
var camStream = null;
document.getElementById('scan-btn').addEventListener('click', openCamera);

async function openCamera() {
    var modal = document.getElementById('cam-modal');
    var video = document.getElementById('cam-video');
    var capBtn = document.getElementById('cam-capture');
    modal.style.display = 'flex';
    document.getElementById('cam-results').innerHTML = '';
    capBtn.textContent = 'Capture';
    capBtn.disabled = false;
    capBtn.onclick = captureNumbers;
    document.getElementById('cam-status').textContent = 'Starting camera...';
    try {
        camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
        video.srcObject = camStream;
        video.style.display = 'block';
        document.getElementById('cam-status').textContent = 'Fill the frame with the list, hold steady, tap Capture.';
    } catch (e) {
        document.getElementById('cam-status').textContent = 'Cannot open camera: ' + e.message;
    }
}

function stopCam() {
    if (camStream) { camStream.getTracks().forEach(function(t){ t.stop(); }); camStream = null; }
    document.getElementById('cam-video').style.display = 'none';
}

function closeCamera() {
    stopCam();
    document.getElementById('cam-modal').style.display = 'none';
}

async function captureNumbers() {
    var video = document.getElementById('cam-video');
    var canvas = document.getElementById('cam-canvas');
    var status = document.getElementById('cam-status');
    if (!camStream || !video.videoWidth) { status.textContent = 'Camera not ready yet.'; return; }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    stopCam();
    status.textContent = 'Reading... closing shortly, check the box below.';
    document.getElementById('cam-capture').disabled = true;
    var n = await scanCanvasIntoBox(canvas);
    closeCamera();
}

</script>
</body>
</html>`);
    } catch (e) {
        res.status(500).send('Error');
    }
});

initDB().then(function() {
    app.listen(PORT, () => {
        console.log('Numbers registry active on port ' + PORT);
    });
}).catch(function(err) {
    console.error('Failed to initialize database:', err);
    process.exit(1);
});
