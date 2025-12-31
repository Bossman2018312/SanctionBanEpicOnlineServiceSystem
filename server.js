const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const cron = require('node-cron');
const rateLimit = require('express-rate-limit'); // NEW SECURITY TOOL

const app = express();

// --- SECURITY: RATE LIMITERS ---
// 1. BLOCK BRUTE FORCE (Protects Login)
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Limit each IP to 10 login requests per window
    message: { error: "⛔ TOO MANY ATTEMPTS. IP BLOCKED FOR 15 MINS." },
    standardHeaders: true,
    legacyHeaders: false,
});

// 2. BLOCK SPAM (Protects Database)
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500, // Limit each IP to 500 requests per 15 mins
    standardHeaders: true,
    legacyHeaders: false,
});

app.use(express.json());
app.use(cors());

// Apply limits to API routes
app.use('/api/', apiLimiter); 

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;

let backupTask = null;

mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
    .then(() => {
        console.log("MongoDB Connected");
        startBackupSchedule();
    })
    .catch(err => console.error("MongoDB Fail:", err));

// --- SCHEMAS ---
const PlayerSchema = new mongoose.Schema({
    productUserId: String, playerId: String, username: String, aliases: [String],
    firstSeen: { type: Date, default: Date.now }, lastSeen: { type: Date, default: Date.now },
    isBanned: { type: Boolean, default: false }, banReason: { type: String, default: "" },
    banExpiresAt: { type: Date, default: null }, banCount: { type: Number, default: 0 },
    sheckles: { type: Number, default: 0 }, scrap: { type: Number, default: 0 }
}, { strict: false }); 

const Player = mongoose.model('Player', PlayerSchema);

const BackupSchema = new mongoose.Schema({
    timestamp: { type: Date, default: Date.now },
    name: { type: String, default: "SNAPSHOT [AUTO]" },
    totalPlayers: Number, bannedCount: Number, cleanCount: Number, data: Object 
});
const Backup = mongoose.model('Backup', BackupSchema);

// AUTH MIDDLEWARE (Now includes Login Limiter check implicitly via /api/ route)
const verifyAdmin = (req, res, next) => {
    if (req.headers['x-admin-auth'] !== process.env.ADMIN_PASSWORD) {
        // Add a small delay to slow down hackers even more
        return setTimeout(() => res.status(403).json({ error: "Access Denied" }), 500);
    }
    next();
};

app.get('/api/stats', verifyAdmin, async (req, res) => {
    const uptime = process.uptime();
    const memory = process.memoryUsage();
    res.json({
        success: true,
        uptime: uptime,
        ram: (memory.rss / 1024 / 1024).toFixed(2),
        status: mongoose.connection.readyState === 1 ? "OPERATIONAL" : "DB_ERROR"
    });
});

// --- BACKUP SYSTEM ---
function startBackupSchedule() {
    if (backupTask) backupTask.stop();
    console.log("Time Machine Online (1-Hour Interval).");
    backupTask = cron.schedule('0 * * * *', async () => {
        console.log("Creating Hourly Backup...");
        await createSnapshot("SNAPSHOT [AUTO]");
    }, { scheduled: true, timezone: "America/New_York" });
}

async function createSnapshot(customName) {
    try {
        const players = await Player.find({}, { _id: 0, __v: 0 });
        if(players.length === 0) return;
        const banned = players.filter(p => p.isBanned).length;
        const clean = players.length - banned;
        
        await new Backup({
            timestamp: new Date(),
            name: customName || "SNAPSHOT [AUTO]",
            totalPlayers: players.length,
            bannedCount: banned, cleanCount: clean, data: players
        }).save();

        const allBackups = await Backup.find().sort({ timestamp: -1 });
        if (allBackups.length > 24) {
            const toDelete = allBackups.slice(24).map(b => b._id);
            await Backup.deleteMany({ _id: { $in: toDelete } });
        }
    } catch (e) { console.error("Snapshot Failed:", e); }
}

// --- ROUTES ---

// APPLY STRICTER LIMITER SPECIFICALLY TO LOGIN/CHECK ACTIONS
app.get('/api/players', loginLimiter, verifyAdmin, async (req, res) => {
    const players = await Player.find().sort({ lastSeen: -1 });
    res.json({ success: true, players });
});

app.post('/api/backups/create', verifyAdmin, async (req, res) => {
    const { name } = req.body;
    await createSnapshot(name);
    res.json({ success: true });
});

app.get('/api/backups', verifyAdmin, async (req, res) => {
    const backups = await Backup.find({}, { data: 0 }).sort({ timestamp: -1 });
    res.json({ success: true, backups });
});

app.get('/api/backups/:id', verifyAdmin, async (req, res) => {
    try {
        const backup = await Backup.findById(req.params.id);
        if(!backup) return res.status(404).json({ error: "Not found" });
        res.json({ success: true, backup });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/backups/restore/:id', verifyAdmin, async (req, res) => {
    try {
        const snapshot = await Backup.findById(req.params.id);
        if (!snapshot) return res.status(404).json({ error: "Backup not found" });
        const players = snapshot.data;
        let count = 0;
        for (const p of players) {
            const pid = p.productUserId || p.playerId;
            if (!pid) continue;
            await Player.findOneAndUpdate({ $or: [{ productUserId: pid }, { playerId: pid }] }, p, { upsert: true, new: true });
            count++;
        }
        res.json({ success: true, count });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/backups/:id', verifyAdmin, async (req, res) => {
    try { await Backup.findByIdAndDelete(req.params.id); res.json({ success: true }); } 
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/players/track', async (req, res) => {
    try {
        let { productUserId, username, sheckles, scrap } = req.body;
        if (!productUserId || productUserId.length < 5) return res.status(400).json({ error: "Invalid ID" });
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

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
