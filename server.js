const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { startBot, forceTestMessage } = require('./bot');

const app = express();
app.use(express.json());
app.use(cors());

const upload = multer({ dest: 'uploads/' });

// FORCE DASHBOARD
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// --- TEST LINK ---
app.get('/test-bot', async (req, res) => {
    console.log("🖱️ Triggering manual backup...");
    try {
        const result = await forceTestMessage();
        res.send(`<h1>✅ Success!</h1><p>Backup sent to Discord. Players saved: ${result.count}</p>`);
    } catch (e) {
        res.send(`
            <h1>❌ Failed</h1>
            <p><b>Error:</b> ${e.message}</p>
            <p>If it says "Bot not ready", wait 10 seconds and refresh.</p>
        `);
    }
});

const PORT = process.env.PORT || 3000;

// CONNECT DB
mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
    .then(() => {
        console.log("✅ MongoDB Connected");
        // START BOT ONLY AFTER DB IS READY (Safer)
        startBot();
    })
    .catch(err => console.error("❌ MongoDB Fail:", err));

const PlayerSchema = new mongoose.Schema({
    productUserId: String, playerId: String, username: String, aliases: [String],
    firstSeen: { type: Date, default: Date.now }, lastSeen: { type: Date, default: Date.now },
    isBanned: { type: Boolean, default: false }, banReason: { type: String, default: "" },
    banExpiresAt: { type: Date, default: null }, banCount: { type: Number, default: 0 },
    sheckles: { type: Number, default: 0 }, scrap: { type: Number, default: 0 }
}, { strict: false }); 

const Player = mongoose.model('Player', PlayerSchema);

// AUTH
const verifyAdmin = (req, res, next) => {
    if (req.headers['x-admin-auth'] !== process.env.ADMIN_PASSWORD) return res.status(403).json({ error: "Access Denied" });
    next();
};

async function checkExpirations() {
    const now = new Date();
    await Player.updateMany({ isBanned: true, banExpiresAt: { $ne: null, $lte: now } }, { $set: { isBanned: false, banReason: "", banExpiresAt: null } });
}

// RESTORE
app.post('/api/restore', verifyAdmin, upload.single('backupFile'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file" });
    try {
        const filePath = req.file.path;
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const players = JSON.parse(fileContent);
        if (!Array.isArray(players)) throw new Error("Invalid JSON");
        let count = 0;
        for (const p of players) {
            const pid = p.productUserId || p.playerId;
            if (!pid) continue;
            delete p._id; delete p.__v;
            await Player.findOneAndUpdate({ $or: [{ productUserId: pid }, { playerId: pid }] }, p, { upsert: true, new: true });
            count++;
        }
        fs.unlinkSync(filePath);
        res.json({ success: true, count });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// API
app.get('/api/players', verifyAdmin, async (req, res) => {
    await checkExpirations();
    const players = await Player.find().sort({ lastSeen: -1 });
    res.json({ success: true, players });
});

app.post('/api/players/track', async (req, res) => {
    try {
        let { productUserId, username, sheckles, scrap } = req.body;
        if (!productUserId || productUserId.length < 5) return res.status(400).json({ error: "Invalid ID" });
        await checkExpirations();
        const updateData = { lastSeen: new Date() };
        if (username && username !== "Checking..." && username !== "Unknown") {
            updateData.username = username;
            updateData.$addToSet = { aliases: username };
        }
        if (sheckles !== undefined) updateData.sheckles = sheckles;
        if (scrap !== undefined) updateData.scrap = scrap;
        const player = await Player.findOneAndUpdate({ $or: [{ productUserId: productUserId }, { playerId: productUserId }] }, updateData, { new: true, upsert: true, setDefaultsOnInsert: true });
        if (!player.productUserId) { player.productUserId = productUserId; await player.save(); }
        res.json({ success: true, isBanned: player.isBanned });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/ban', verifyAdmin, async (req, res) => {
    const { productUserId, reason, durationMinutes } = req.body;
    let expireDate = null;
    if (durationMinutes && parseInt(durationMinutes) > 0) {
        expireDate = new Date();
        expireDate.setMinutes(expireDate.getMinutes() + parseInt(durationMinutes));
    }
    await Player.findOneAndUpdate({ $or: [{ productUserId: productUserId }, { playerId: productUserId }] }, { isBanned: true, banReason: reason || "Admin Ban", banExpiresAt: expireDate, $inc: { banCount: 1 } });
    res.json({ success: true });
});

app.post('/api/unban', verifyAdmin, async (req, res) => {
    await Player.findOneAndUpdate({ $or: [{ productUserId: req.body.productUserId }, { playerId: req.body.productUserId }] }, { isBanned: false, banReason: "", banExpiresAt: null });
    res.json({ success: true });
});

app.post('/api/delete', verifyAdmin, async (req, res) => {
    await Player.findOneAndDelete({ $or: [{ productUserId: req.body.productUserId }, { playerId: req.body.productUserId }] });
    res.json({ success: true });
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
