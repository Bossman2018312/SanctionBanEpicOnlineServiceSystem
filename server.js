const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());
app.use(cors());

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
// Using the connection string you provided (Recommend keeping this in .env on Render)
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://BOSS:ilikemath@cluster0.0c1y6c.mongodb.net/?appName=Cluster0";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "ilikemath"; // Ensure this matches MirrorVRConfig

// --- CONNECT TO MONGODB ---
mongoose.connect(MONGODB_URI)
    .then(() => console.log("✅ Connected to MongoDB"))
    .catch(err => console.error("❌ MongoDB Error:", err));

// --- SCHEMA ---
const PlayerSchema = new mongoose.Schema({
    productUserId: { type: String, required: true, unique: true },
    username: String,
    aliases: [String],
    firstSeen: { type: Date, default: Date.now },
    lastSeen: { type: Date, default: Date.now },
    isBanned: { type: Boolean, default: false },
    banReason: { type: String, default: "" }
});
const Player = mongoose.model('Player', PlayerSchema);

// --- MIDDLEWARE ---
const verifyAdminPassword = (req, res, next) => {
    const provided = req.headers['x-admin-auth'];
    if (provided !== ADMIN_PASSWORD) {
        return res.status(403).json({ success: false, error: "WRONG PASSWORD" });
    }
    next();
};

// --- ROUTES ---

// 1. TRACK & CHECK (Called by Game Client on Join)
// Returns { success: true, isBanned: true/false } so the game knows to kick immediately.
app.post('/api/players/track', async (req, res) => {
    try {
        const { productUserId, username } = req.body;
        if (!productUserId) return res.status(400).json({ error: "Missing ID" });

        const player = await Player.findOneAndUpdate(
            { productUserId }, 
            { 
                $set: { lastSeen: new Date(), username }, 
                $addToSet: { aliases: username } 
            }, 
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        res.json({ success: true, isBanned: player.isBanned });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2. GET ALL PLAYERS (Called by Unity Editor)
app.get('/api/players', verifyAdminPassword, async (req, res) => {
    try {
        const players = await Player.find().sort({ lastSeen: -1 });
        res.json({ success: true, players });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3. BAN PLAYER (Called by Unity Editor)
// Updates MongoDB directly.
app.post('/api/ban', verifyAdminPassword, async (req, res) => {
    try {
        const { productUserId, reason } = req.body;
        if (!productUserId) return res.status(400).json({ error: "Missing ID" });

        console.log(`🔨 Banning Player: ${productUserId}`);

        await Player.findOneAndUpdate(
            { productUserId },
            { isBanned: true, banReason: reason || "Banned by Admin" },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        res.json({ success: true, message: "Player Banned in MongoDB" });
    } catch (err) {
        console.error("❌ Ban Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 4. UNBAN PLAYER (Called by Unity Editor)
app.post('/api/unban', verifyAdminPassword, async (req, res) => {
    try {
        const { productUserId } = req.body;
        if (!productUserId) return res.status(400).json({ error: "Missing ID" });

        console.log(`🔓 Unbanning Player: ${productUserId}`);

        await Player.findOneAndUpdate(
            { productUserId },
            { isBanned: false, banReason: "" }
        );

        res.json({ success: true, message: "Player Unbanned in MongoDB" });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/', (req, res) => res.send(`✅ MONGO BAN SYSTEM ONLINE`));

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
