const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const cron = require('node-cron');
const multer = require('multer');

const app = express();
app.use(express.json());
app.use(cors());

// FORCE DASHBOARD
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;

// CONNECT DB
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
    totalPlayers: Number,
    bannedCount: Number, 
    cleanCount: Number,  
    data: Object 
});
const Backup = mongoose.model('Backup', BackupSchema);

// --- AUTH ---
const verifyAdmin = (req, res, next) => {
    if (req.headers['x-admin-auth'] !== process.env.ADMIN_PASSWORD) return res.status(403).json({ error: "Access Denied" });
    next();
};

// --- AUTOMATED BACKUP SYSTEM (24 HR LOOP) ---
function startBackupSchedule() {
    console.log("Time Machine System Online (24-Hour Retention).");
    
    // Run Every Hour
    cron.schedule('0 * * * *', async () => {
        console.log("Creating Hourly Backup...");
        await createSnapshot();
    }, { scheduled: true, timezone: "America/New_York" });
}

async function createSnapshot() {
    try {
        const players = await Player.find({}, { _id: 0, __v: 0 });
        if(players.length === 0) return;

        // Calculate stats for the dashboard
        const banned = players.filter(p => p.isBanned).length;
        const clean = players.length - banned;

        await new Backup({
            timestamp: new Date(),
            totalPlayers: players.length,
            bannedCount: banned,
            cleanCount: clean,
            data: players
        }).save();

        console.log(`Snapshot Saved! (${players.length} players)`);

        // CLEANUP: Delete anything older than 24 hours
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const result = await Backup.deleteMany({ timestamp: { $lt: cutoff } });
        
        if (result.deletedCount > 0) console.log(`Deleted ${result.deletedCount} old backups.`);

    } catch (e) { console.error("Snapshot Failed:", e); }
}

// --- API ROUTES ---

// Create Manual Snapshot
app.post('/api/backups/create', verifyAdmin, async (req, res) => {
    await createSnapshot();
    res.json({ success: true });
});

// List Backups (Metadata Only)
app.get('/api/backups', verifyAdmin, async (req, res) => {
    const backups = await Backup.find({}, { data: 0 }).sort({ timestamp: -1 });
    res.json({ success: true, backups });
});

// GET SINGLE BACKUP (For Viewing)
app.get('/api/backups/:id', verifyAdmin, async (req, res) => {
    try {
        const backup = await Backup.findById(req.params.id);
        if(!backup) return res.status(404).json({ error: "Not found" });
        res.json({ success: true, backup });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Restore Backup
app.post('/api/backups/restore/:id', verifyAdmin, async (req, res) => {
    try {
        const snapshot = await Backup.findById(req.params.id);
        if (!snapshot) return res.status(404).json({ error: "Backup not found" });

        const players = snapshot.data;
        if (!Array.isArray(players)) throw new Error("Corrupt Data");

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

// [Standard Player Routes]
app.get('/api/players', verifyAdmin, async (req, res) => {
    const players = await Player.find().sort({ lastSeen: -1 });
    res.json({ success: true, players });
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

        const player = await Player.findOneAndUpdate(
            { $or: [{ productUserId: productUserId }, { playerId: productUserId }] },
            updateData,
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );
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
