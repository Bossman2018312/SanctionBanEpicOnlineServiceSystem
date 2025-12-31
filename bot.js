const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
const mongoose = require('mongoose');
const cron = require('node-cron');

// --- CONFIGURATION ---
const CHANNEL_ID = "1455641113447633027"; 
// ---------------------

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
let isStarting = false;

function startBot() {
    if (isStarting) return;
    isStarting = true;

    console.log("🔍 [DIAGNOSTIC] Checking Environment Variables...");
    
    // 1. CHECK IF TOKEN EXISTS
    const token = process.env.DISCORD_BOT_TOKEN;

    if (!token) {
        console.error("❌ [CRITICAL] DISCORD_BOT_TOKEN is completely MISSING/UNDEFINED in Render.");
        console.error("👉 Go to Render Dashboard -> Environment -> Add 'DISCORD_BOT_TOKEN'");
        return;
    }

    // 2. CHECK TOKEN LENGTH & FORMAT (Safely)
    console.log(`ℹ️ [DIAGNOSTIC] Token found! Length: ${token.length} characters.`);
    if (token.length < 50) {
        console.error("❌ [CRITICAL] Token looks too short! You might have copied the 'Public Key' or 'Client Secret'.");
        console.error("👉 A real Bot Token is usually ~70 characters long.");
        return;
    }
    console.log(`ℹ️ [DIAGNOSTIC] Token starts with: ${token.substring(0, 5)}...`);

    // 3. ATTEMPT LOGIN
    console.log("🤖 [BOT] Attempting to login...");
    client.login(token)
        .then(() => console.log("✅ [BOT] LOGIN SUCCESSFUL!"))
        .catch(err => {
            console.error("❌ [BOT] Login Failed. Discord rejected the token.");
            console.error("👉 Error Details:", err.message);
            if (err.code === 'TokenInvalid') {
                console.error("👉 ACTION: Go to Discord Developer Portal -> Bot -> Reset Token -> Copy NEW Token -> Paste in Render.");
            }
        });

    client.once('ready', () => {
        console.log(`✅ [BOT] Online as ${client.user.tag}`);
        // Schedule
        cron.schedule('59 23 * * *', () => {
            console.log("⏳ [BOT] Auto-Backup Triggered...");
            runBackup();
        }, { scheduled: true, timezone: "America/New_York" });
    });
}

async function runBackup() {
    // Wait logic
    if (!client.isReady()) {
        console.log("⚠️ [BOT] Not ready... waiting 3 seconds...");
        await new Promise(r => setTimeout(r, 3000));
        if (!client.isReady()) throw new Error("Bot failed to connect. Check Render Logs for 'Login Failed'.");
    }

    try {
        const channel = await client.channels.fetch(CHANNEL_ID);
        if (!channel) throw new Error(`Channel ${CHANNEL_ID} not found. Kick and re-invite bot.`);

        const Player = mongoose.model('Player');
        const players = await Player.find({}, { _id: 0, __v: 0 });
        
        const jsonData = JSON.stringify(players, null, 2);
        const buffer = Buffer.from(jsonData, 'utf-8');
        const dateStr = new Date().toISOString().replace(/:/g, '-');
        const fileName = `GW_Backup_${dateStr}.json`;

        const attachment = new AttachmentBuilder(buffer, { name: fileName });
        await channel.send({ 
            content: `🛡️ **MANUAL BACKUP**\n👥 Players: ${players.length}`, 
            files: [attachment] 
        });

        console.log("✅ [BOT] Backup sent!");
        return { success: true, count: players.length };

    } catch (err) {
        console.error("❌ [BOT] Backup Error:", err.message);
        throw err;
    }
}

module.exports = { startBot, forceTestMessage: runBackup };
