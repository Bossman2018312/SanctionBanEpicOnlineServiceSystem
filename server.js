const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

// FORCE DASHBOARD
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;

mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => console.error("❌ MongoDB Fail:", err));

const PlayerSchema = new mongoose.Schema({
    productUserId: String, // New
    playerId: String,      // Old Support
    username: String,
    aliases: [String],
    firstSeen: { type: Date, default: Date.now },
    lastSeen: { type: Date, default: Date.now },
    isBanned: { type: Boolean, default: false },
    banReason: { type: String, default: "" },
    banExpiresAt: { type: Date, default: null },
    banCount: { type: Number, default: 0 },
    sheckles: { type: Number, default: 0 },
    scrap: { type: Number, default: 0 }
}, { strict: false });

const Player = mongoose.model('Player', PlayerSchema);

const verifyAdmin = (req, res, next) => {
    if (req.headers['x-admin-auth'] !== process.env.ADMIN_PASSWORD) return res.status(403).json({ error: "Access Denied" });
    next();
};

// AUTO-UNBAN CHECK
async function checkExpirations() {
    const now = new Date();
    // Unban anyone whose expiry time has passed
    await Player.updateMany(
        { isBanned: true, banExpiresAt: { $ne: null, $lte: now } },
        { $set: { isBanned: false, banReason: "", banExpiresAt: null } }
    );
}

// 1. GET PLAYERS
app.get('/api/players', verifyAdmin, async (req, res) => {
    await checkExpirations(); 
    
    try {
        const rawPlayers = await Player.find().sort({ lastSeen: -1 });
        const players = rawPlayers.map(p => ({
            productUserId: p.productUserId || p.playerId || "UNKNOWN_ID",
            username: p.username || "Unknown",
            isBanned: p.isBanned || false,
            banReason: p.banReason || "",
            banExpiresAt: p.banExpiresAt,
            sheckles: p.sheckles || p.coins || 0,
            scrap: p.scrap || 0,
            firstSeen: p.firstSeen,
            lastSeen: p.lastSeen,
            banCount: p.banCount || 0
        }));
        
        const cleanList = players.filter(p => p.productUserId !== "UNKNOWN_ID" && p.productUserId !== "undefined");
        res.json({ success: true, players: cleanList });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 2. TRACKING
app.post('/api/players/track', async (req, res) => {
    try {
        let { productUserId, username, sheckles, scrap } = req.body;
        if (!productUserId || productUserId.length < 5) return res.status(400).json({ error: "Invalid ID" });

        await checkExpirations();

        const updateData = {
            username: username,
            lastSeen: new Date(),
            $addToSet: { aliases: username }
        };
        if (sheckles !== undefined) updateData.sheckles = sheckles;
        if (scrap !== undefined) updateData.scrap = scrap;

        const player = await Player.findOneAndUpdate(
            { $or: [{ productUserId: productUserId }, { playerId: productUserId }] },
            updateData,
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );
        
        if (!player.productUserId) {
            player.productUserId = productUserId;
            await player.save();
        }

        res.json({ success: true, isBanned: player.isBanned });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. BAN (Handles Timed Bans)
app.post('/api/ban', verifyAdmin, async (req, res) => {
    const { productUserId, reason, durationMinutes } = req.body;
    let expireDate = null;
    
    // Only set expiry if time is > 0
    if (durationMinutes && parseInt(durationMinutes) > 0) {
        expireDate = new Date();
        expireDate.setMinutes(expireDate.getMinutes() + parseInt(durationMinutes));
    }

    await Player.findOneAndUpdate(
        { $or: [{ productUserId: productUserId }, { playerId: productUserId }] },
        { 
            isBanned: true, 
            banReason: reason || "Admin Ban", 
            banExpiresAt: expireDate, 
            $inc: { banCount: 1 } 
        }
    );
    res.json({ success: true });
});

app.post('/api/unban', verifyAdmin, async (req, res) => {
    await Player.findOneAndUpdate(
        { $or: [{ productUserId: req.body.productUserId }, { playerId: req.body.productUserId }] },
        { isBanned: false, banReason: "", banExpiresAt: null }
    );
    res.json({ success: true });
});

app.post('/api/delete', verifyAdmin, async (req, res) => {
    await Player.findOneAndDelete({ $or: [{ productUserId: req.body.productUserId }, { playerId: req.body.productUserId }] });
    res.json({ success: true });
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
