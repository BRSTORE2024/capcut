const express = require('express');
const Datastore = require('nedb-promises');
const fs = require('fs');
const path = require('path');
const logic = require('./logic');
const config = require('./config');
const capcut = require('./capcut'); 
const checksub = require('./checksub'); // TAMBAHKAN INI agar server mengenali file checksub.js
const app = express();

// Pastikan folder data ada
if (!fs.existsSync('./data')) fs.mkdirSync('./data');

const db = Datastore.create({ filename: './data/database.db', autoload: true });

app.use(express.json());
app.use(express.static('public'));

// === API: AMBIL RIWAYAT ===
app.get('/api/history', async (req, res) => {
    try {
        const data = await db.find({}).sort({ timestamp: -1 });
        res.json(data);
    } catch (err) {
        res.status(500).json({ msg: 'Database error' });
    }
});

// === API: DOWNLOAD CSV ===
app.get('/api/download/:id', async (req, res) => {
    try {
        const job = await db.findOne({ _id: req.params.id });
        if (!job || !job.accounts.length) return res.status(404).send('No accounts found');

        let csvContent = "Email,Password,Status\n";
        job.accounts.forEach(acc => {
            csvContent += `${acc.email},${acc.password},Success\n`;
        });

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=accounts-${req.params.id}.csv`);
        res.status(200).send(csvContent);
    } catch (err) {
        res.status(500).send('Error generating CSV');
    }
});

// === API: DAFTAR DOMAIN ===
app.get('/api/domains', (req, res) => {
    const domains = logic.loadDomainsFromFile();
    res.json(domains);
});

// === API: TAMBAH DOMAIN ===
app.post('/api/domains', (req, res) => {
    const { domain } = req.body;
    if (!domain) return res.status(400).json({ msg: 'Domain required' });
    
    try {
        const domains = logic.loadDomainsFromFile();
        if (!domains.includes(domain)) {
            const dataToAppend = domains.length === 0 ? domain : `\n${domain}`;
            fs.appendFileSync(config.DOMAINS_FILE, dataToAppend, 'utf8');
            res.json({ success: true, msg: 'Domain added' });
        } else {
            res.status(400).json({ msg: 'Domain already exists' });
        }
    } catch (err) {
        res.status(500).json({ msg: 'Error saving domain' });
    }
});

// === API: HAPUS DOMAIN (MANUAL) ===
app.delete('/api/domains', (req, res) => {
    const { domain } = req.body;
    if (!domain) return res.status(400).json({ msg: 'Domain required' });

    try {
        logic.removeDomainFromFile(domain);
        res.json({ success: true, msg: 'Domain deleted' });
    } catch (err) {
        res.status(500).json({ msg: 'Error deleting domain' });
    }
});

// === API: MULAI PROSES (BUAT AKUN LAMA) ===
app.post('/api/start', async (req, res) => {
    const { link, count, password } = req.body;
    const domains = logic.loadDomainsFromFile();

    if (domains.length === 0) {
        return res.status(400).json({ msg: 'No domains available!' });
    }

    const doc = await db.insert({ 
        link, 
        timestamp: Date.now(), 
        status: 'Processing', 
        target: parseInt(count), 
        accounts: [], 
        failed: 0 
    });

    (async () => {
        const targetCount = parseInt(count);
        const maxThreads = Math.min(targetCount, 5);
        let currentFinished = 0;
        let activeIndex = 0;

        const worker = async () => {
            while (activeIndex < targetCount) {
                const i = activeIndex++; 
                try {
                    const domainIdx = Math.floor(i / 15);
                    const currentDomain = domains[domainIdx] || domains[domains.length - 1];
                    const acc = await logic.createAccount(domains, link, password, currentDomain);
                    await db.update({ _id: doc._id }, { $push: { accounts: acc } });

                    if ((i + 1) % 15 === 0 && domainIdx < domains.length) {
                        logic.removeDomainFromFile(currentDomain);
                    }
                } catch (err) {
                    await db.update({ _id: doc._id }, { $inc: { failed: 1 } });
                } finally {
                    currentFinished++;
                    if (currentFinished >= targetCount) {
                        await db.update({ _id: doc._id }, { $set: { status: 'Completed' } });
                    }
                }
            }
        };

        const threads = Array(maxThreads).fill().map(() => worker());
        await Promise.all(threads);
    })();

    res.json({ id: doc._id, msg: 'Task started' });
});

// === API: CAPCUT SINGLE JOIN TEAM ===
app.post('/api/capcut/join', async (req, res) => {
    const { email, password, inviteLink, proxy } = req.body;
    
    if (!email || !password || !inviteLink) {
        return res.status(400).json({ msg: 'Data tidak lengkap!' });
    }

    const doc = await db.insert({ 
        type: 'CapCut Join',
        email, 
        timestamp: Date.now(), 
        status: 'Processing',
        log: 'Memulai login CapCut...'
    });

    (async () => {
        try {
            const sessionCookie = await capcut.loginCapcut(email.trim(), password.trim(), proxy || null);
            await db.update({ _id: doc._id }, { $set: { log: 'Login sukses, mencoba join team...' } });
            const joinRes = await capcut.joinTeam(inviteLink.trim(), sessionCookie, proxy || null);
            
            if (joinRes.ret === 0 || joinRes.ret === '0' || joinRes.status_code === 0) {
                await db.update({ _id: doc._id }, { 
                    $set: { status: 'Completed', log: 'Berhasil join team CapCut!' } 
                });
            } else {
                throw new Error(joinRes.msg || joinRes.errmsg || 'Gagal bergabung ke team');
            }
        } catch (err) {
            await db.update({ _id: doc._id }, { 
                $set: { status: 'Failed', log: err.message } 
            });
        }
    })();

    res.json({ id: doc._id, msg: 'Proses CapCut dimulai' });
});

// === API: CAPCUT BULK JOINER (VERSI FIX) ===
app.post('/api/capcut/bulk-join', async (req, res) => {
    const { bulkData, inviteLink, proxy } = req.body;

    if (!bulkData || !inviteLink) {
        return res.status(400).json({ msg: 'Data bulk (email|pass) dan Link wajib diisi!' });
    }

    const lines = bulkData.split(/\r?\n/).filter(line => line.trim().includes('|'));
    
    if (lines.length === 0) {
        return res.status(400).json({ msg: 'Format salah! Gunakan email|password per baris.' });
    }

    const doc = await db.insert({ 
        type: 'CapCut Bulk',
        link: inviteLink.trim(),
        timestamp: Date.now(), 
        status: 'Processing',
        target: lines.length,
        accounts: [],
        failed: 0,
        log: `Memulai proses bulk untuk ${lines.length} akun...`
    });

    (async () => {
        for (let i = 0; i < lines.length; i++) {
            const currentLine = lines[i].trim();
            const parts = currentLine.split('|');
            if (parts.length < 2) continue;

            const email = parts[0].trim();
            const password = parts[1].trim();

            try {
                await db.update({ _id: doc._id }, { $set: { log: `[${i+1}/${lines.length}] Login: ${email}` } });
                const sessionCookie = await capcut.loginCapcut(email, password, proxy || null);
                await db.update({ _id: doc._id }, { $set: { log: `[${i+1}/${lines.length}] Joining: ${email}` } });
                const joinRes = await capcut.joinTeam(inviteLink.trim(), sessionCookie, proxy || null);

                if (joinRes.ret === 0 || joinRes.ret === '0' || joinRes.status_code === 0) {
                    await db.update({ _id: doc._id }, { 
                        $push: { accounts: { email, password, status: 'Success' } } 
                    });
                } else {
                    throw new Error(joinRes.msg || joinRes.errmsg || 'Join Failed');
                }
            } catch (err) {
                console.error(`[BULK ERR] ${email}:`, err.message);
                await db.update({ _id: doc._id }, { 
                    $inc: { failed: 1 },
                    $push: { accounts: { email, password, status: `Error: ${err.message}` } }
                });
            }
            await new Promise(r => setTimeout(r, 1000));
        }
        await db.update({ _id: doc._id }, { $set: { status: 'Completed', log: 'Bulk join selesai.' } });
    })();

    res.json({ id: doc._id, msg: 'Bulk process started' });
});

// === API BARU: CAPCUT CHECK SUBSCRIPTION ===
app.post('/api/capcut/check-sub', async (req, res) => {
    const { email, password, proxy } = req.body;

    if (!email || !password) {
        return res.status(400).json({ msg: 'Email dan Password wajib diisi!' });
    }

    const doc = await db.insert({ 
        type: 'CapCut Check',
        email: email.trim(), 
        timestamp: Date.now(), 
        status: 'Processing',
        log: 'Menyiapkan login mobile...'
    });

    (async () => {
        try {
            // Memanggil fungsi dari file checksub.js
            const info = await checksub.checkTeamDuration(email.trim(), password.trim(), proxy || null);
            
            await db.update({ _id: doc._id }, { 
                $set: { 
                    status: 'Completed', 
                    log: `Sukses! Durasi: ${info.daysRemaining} Hari (${info.workspaceName})` 
                } 
            });
        } catch (err) {
            await db.update({ _id: doc._id }, { 
                $set: { status: 'Failed', log: err.message } 
            });
        }
    })();

    res.json({ id: doc._id, msg: 'Pengecekan subscription dimulai' });
});

// === API: UPDATE DATA AKUN (Email/Buyer Manual) ===
app.post('/api/database/update-account', async (req, res) => {
    const { jobId, emailIndex, newEmail, buyerName } = req.body;
    try {
        const job = await db.findOne({ _id: jobId });
        if (!job) return res.status(404).json({ msg: 'Data tidak ditemukan' });

        if (job.accounts && job.accounts[emailIndex]) {
            job.accounts[emailIndex].email = newEmail;
            job.accounts[emailIndex].buyer = buyerName; 
        }

        await db.update({ _id: jobId }, { $set: { accounts: job.accounts } });
        res.json({ success: true, msg: 'Data akun diperbarui' });
    } catch (err) {
        res.status(500).json({ msg: 'Gagal memperbarui database' });
    }
});

// === API: UPDATE LINK UTAMA ===
app.post('/api/database/update-link', async (req, res) => {
    const { jobId, newLink } = req.body;
    try {
        await db.update({ _id: jobId }, { $set: { link: newLink } });
        res.json({ success: true, msg: 'Link diperbarui' });
    } catch (err) {
        res.status(500).json({ msg: 'Gagal update link' });
    }
});

// === API: HAPUS DATA PERMANEN DARI DATABASE CENTER ===
app.delete('/api/database/delete/:id', async (req, res) => {
    try {
        await db.remove({ _id: req.params.id });
        res.json({ success: true, msg: 'Data dihapus permanen' });
    } catch (err) {
        res.status(500).json({ msg: 'Gagal menghapus data' });
    }
});

// === API: HAPUS RIWAYAT (Eksisting) ===
app.delete('/api/history/:id', async (req, res) => {
    try {
        await db.remove({ _id: req.params.id });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ msg: 'Failed to delete history' });
    }
});

app.listen(3000, () => console.log('🚀 Server running at http://localhost:3000'));