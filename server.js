const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => console.error("❌ MongoDB Fail:", err));

const PlayerSchema = new mongoose.Schema({
    productUserId: { type: String, required: true, unique: true },
    username: String,
    aliases: [String],
    firstSeen: { type: Date, default: Date.now }, // Creation Time
    lastSeen: { type: Date, default: Date.now },
    isBanned: { type: Boolean, default: false },
    banReason: { type: String, default: "" },
    banExpiresAt: { type: Date, default: null },
    banCount: { type: Number, default: 0 },
    sheckles: { type: Number, default: 0 },
    scrap: { type: Number, default: 0 }
});
const Player = mongoose.model('Player', PlayerSchema);

const verifyAdmin = (req, res, next) => {
    if (req.headers['x-admin-auth'] !== process.env.ADMIN_PASSWORD) return res.status(403).json({ error: "Access Denied" });
    next();
};

// HELPER: CHECK EXPIRY
async function checkExpirations() {
    const now = new Date();
    await Player.updateMany(
        { isBanned: true, banExpiresAt: { $ne: null, $lte: now } },
        { $set: { isBanned: false, banReason: "", banExpiresAt: null } }
    );
}

// 1. TRACK PLAYER (Preserves Creation Time)
app.post('/api/players/track', async (req, res) => {
    try {
        const { productUserId, username, sheckles, scrap } = req.body;
        if (!productUserId) return res.status(400).json({ error: "No ID" });

        await checkExpirations(); // Check if this player's ban expired just now

        let player = await Player.findOne({ productUserId });

        if (!player) {
            player = new Player({ 
                productUserId, 
                username, 
                aliases: [username], 
                sheckles: sheckles || 0, 
                scrap: scrap || 0,
                firstSeen: new Date() // Set ONLY once
            });
        } else {
            player.username = username;
            player.lastSeen = new Date();
            if (!player.aliases.includes(username)) player.aliases.push(username);
            if (sheckles !== undefined) player.sheckles = sheckles;
            if (scrap !== undefined) player.scrap = scrap;
        }
        await player.save();

        res.json({ success: true, isBanned: player.isBanned });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. GET PLAYERS (Auto-updates expired bans before sending list)
app.get('/api/players', verifyAdmin, async (req, res) => {
    await checkExpirations(); // Fixes "Timed ban didn't revoke"
    const players = await Player.find().sort({ lastSeen: -1 });
    res.json({ success: true, players });
});

// 3. BAN (Increments count)
app.post('/api/ban', verifyAdmin, async (req, res) => {
    try {
        const { productUserId, reason, durationMinutes } = req.body;
        let expireDate = null;
        if (durationMinutes > 0) {
            expireDate = new Date();
            expireDate.setMinutes(expireDate.getMinutes() + parseInt(durationMinutes));
        }

        await Player.findOneAndUpdate(
            { productUserId },
            { 
                isBanned: true, 
                banReason: reason || "Admin Ban",
                banExpiresAt: expireDate,
                $inc: { banCount: 1 }
            },
            { upsert: true }
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. UNBAN (Fixed Revoke)
app.post('/api/unban', verifyAdmin, async (req, res) => {
    await Player.findOneAndUpdate({ productUserId: req.body.productUserId }, { isBanned: false, banReason: "", banExpiresAt: null });
    res.json({ success: true });
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
