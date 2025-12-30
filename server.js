const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

// FORCE DASHBOARD LOAD
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;

mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => console.error("❌ MongoDB Fail:", err));

const PlayerSchema = new mongoose.Schema({
    productUserId: { type: String, required: true, unique: true },
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
});
const Player = mongoose.model('Player', PlayerSchema);

const verifyAdmin = (req, res, next) => {
    if (req.headers['x-admin-auth'] !== process.env.ADMIN_PASSWORD) return res.status(403).json({ error: "Access Denied" });
    next();
};

async function checkExpirations() {
    const now = new Date();
    await Player.updateMany(
        { isBanned: true, banExpiresAt: { $ne: null, $lte: now } },
        { $set: { isBanned: false, banReason: "", banExpiresAt: null } }
    );
}

// 1. TRACKING (Strict ID Check + No "undefined" allowed)
app.post('/api/players/track', async (req, res) => {
    try {
        let { productUserId, username, sheckles, scrap } = req.body;

        // STOP GHOSTS: Reject bad IDs immediately
        if (!productUserId || productUserId === "undefined" || productUserId.trim().length < 5) {
            return res.status(400).json({ error: "Invalid ID" });
        }

        await checkExpirations();

        const updateData = {
            username: username,
            lastSeen: new Date(),
            $addToSet: { aliases: username }
        };
        
        if (sheckles !== undefined) updateData.sheckles = sheckles;
        if (scrap !== undefined) updateData.scrap = scrap;

        // Only create new if ID is valid
        const player = await Player.findOneAndUpdate(
            { productUserId: productUserId },
            updateData,
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );

        res.json({ success: true, isBanned: player.isBanned });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/players', verifyAdmin, async (req, res) => {
    await checkExpirations();
    // Filter out bad IDs from the list before sending to website
    const players = await Player.find({ productUserId: { $ne: "undefined" } }).sort({ lastSeen: -1 });
    res.json({ success: true, players });
});

// 2. BAN (Prevents creating new users)
app.post('/api/ban', verifyAdmin, async (req, res) => {
    try {
        const { productUserId, reason, durationMinutes } = req.body;

        if (!productUserId || productUserId === "undefined") return res.status(400).json({ error: "Bad ID" });

        let expireDate = null;
        if (durationMinutes > 0) {
            expireDate = new Date();
            expireDate.setMinutes(expireDate.getMinutes() + parseInt(durationMinutes));
        }

        // upsert: FALSE ensures we never create a ghost user when banning
        const result = await Player.findOneAndUpdate(
            { productUserId },
            { 
                isBanned: true, 
                banReason: reason || "Admin Ban", 
                banExpiresAt: expireDate,
                $inc: { banCount: 1 } 
            },
            { upsert: false } 
        );

        if (!result) return res.status(404).json({ error: "Player not found" });

        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/unban', verifyAdmin, async (req, res) => {
    await Player.findOneAndUpdate({ productUserId: req.body.productUserId }, { isBanned: false, banReason: "", banExpiresAt: null });
    res.json({ success: true });
});

app.post('/api/delete', verifyAdmin, async (req, res) => {
    try {
        await Player.findOneAndDelete({ productUserId: req.body.productUserId });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
