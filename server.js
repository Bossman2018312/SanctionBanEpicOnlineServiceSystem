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

// 1. TRACK PLAYER (Fixed Duplicates)
app.post('/api/players/track', async (req, res) => {
    try {
        const { productUserId, username, sheckles, scrap } = req.body;
        if (!productUserId) return res.status(400).json({ error: "No ID" });

        await checkExpirations();

        // Use updateOne with upsert to prevent duplicates
        const updateData = {
            username: username,
            lastSeen: new Date(),
            $addToSet: { aliases: username } // Only add alias if unique
        };
        
        if (sheckles !== undefined) updateData.sheckles = sheckles;
        if (scrap !== undefined) updateData.scrap = scrap;

        const player = await Player.findOneAndUpdate(
            { productUserId },
            updateData,
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );

        res.json({ success: true, isBanned: player.isBanned });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/players', verifyAdmin, async (req, res) => {
    await checkExpirations();
    const players = await Player.find().sort({ lastSeen: -1 });
    res.json({ success: true, players });
});

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

app.post('/api/unban', verifyAdmin, async (req, res) => {
    await Player.findOneAndUpdate({ productUserId: req.body.productUserId }, { isBanned: false, banReason: "", banExpiresAt: null });
    res.json({ success: true });
});

// NEW: DELETE USER ROUTE
app.post('/api/delete', verifyAdmin, async (req, res) => {
    try {
        await Player.findOneAndDelete({ productUserId: req.body.productUserId });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
