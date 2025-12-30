const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => console.error("❌ MongoDB Fail:", err));

// --- UPDATED SCHEMA ---
const PlayerSchema = new mongoose.Schema({
    productUserId: { type: String, required: true, unique: true },
    username: String,
    aliases: [String],
    firstSeen: { type: Date, default: Date.now },
    lastSeen: { type: Date, default: Date.now },
    
    // Ban Info
    isBanned: { type: Boolean, default: false },
    banReason: { type: String, default: "" },
    banExpiresAt: { type: Date, default: null },
    banCount: { type: Number, default: 0 }, // New: Tracks total bans

    // Economy
    sheckles: { type: Number, default: 0 },
    scrap: { type: Number, default: 0 }
});
const Player = mongoose.model('Player', PlayerSchema);

const verifyAdmin = (req, res, next) => {
    if (req.headers['x-admin-auth'] !== process.env.ADMIN_PASSWORD) 
        return res.status(403).json({ error: "Access Denied" });
    next();
};

// --- ROUTES ---

// 1. TRACK & UPDATE PLAYER
app.post('/api/players/track', async (req, res) => {
    try {
        const { productUserId, username, sheckles, scrap } = req.body;
        if (!productUserId) return res.status(400).json({ error: "No ID" });

        let player = await Player.findOne({ productUserId });

        // Auto-Unban Logic
        if (player && player.isBanned && player.banExpiresAt) {
            if (new Date() > new Date(player.banExpiresAt)) {
                player.isBanned = false;
                player.banReason = "";
                player.banExpiresAt = null;
            }
        }

        if (!player) {
            player = new Player({ 
                productUserId, 
                username, 
                aliases: [username], 
                sheckles: sheckles || 0, 
                scrap: scrap || 0 
            });
        } else {
            player.username = username;
            player.lastSeen = new Date();
            if (!player.aliases.includes(username)) player.aliases.push(username);
            
            // Update Money
            if (sheckles !== undefined) player.sheckles = sheckles;
            if (scrap !== undefined) player.scrap = scrap;
        }
        await player.save();

        res.json({ success: true, isBanned: player.isBanned });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/players', verifyAdmin, async (req, res) => {
    const players = await Player.find().sort({ lastSeen: -1 });
    res.json({ success: true, players });
});

// 2. BAN ROUTE (Increments Count)
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
                $inc: { banCount: 1 } // Increases ban count by 1
            },
            { upsert: true }
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/unban', verifyAdmin, async (req, res) => {
    await Player.findOneAndUpdate({ productUserId: req.body.productUserId }, { isBanned: false, banReason: "", banExpiresAt: null });
    res.json({ success: true });
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
