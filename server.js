const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const cron = require('node-cron');

const app = express();
app.set('trust proxy', 1); 

app.use(express.json());
app.use(cors());

// FORCE DASHBOARD
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;

let backupTask = null;

mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
    .then(() => {
        console.log("MongoDB Connected (LOCKDOWN MODE)");
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

// --- *** TOTAL LOCKDOWN SECURITY *** ---
const verifyAdmin = (req, res, next) => {
    // REJECT EVERYTHING.
    return res.status(403).send("⛔ SYSTEM IS UNDER LOCKDOWN. CONNECTION REFUSED.");
};

// --- BACKUP SYSTEM (30 SLOTS) ---
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

        // LIMIT INCREASED TO 30
        const allBackups = await Backup.find().sort({ timestamp: -1 });
        if (allBackups.length > 30) {
            const toDelete = allBackups.slice(30).map(b => b._id);
            await Backup.deleteMany({ _id: { $in: toDelete } });
        }
    } catch
