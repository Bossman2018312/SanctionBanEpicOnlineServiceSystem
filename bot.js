const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
const mongoose = require('mongoose');
const cron = require('node-cron');

// --- CONFIGURATION ---
const CHANNEL_ID = "1455641113447633027"; 
// ---------------------

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
let isStarting = false;

function startBot() {
    if (isStarting) return; // Prevent double login
    isStarting = true;

    console.log("🤖 [BOT] Starting login process...");
    
    // SECURE: Get Token from Render Environment
    const token = process.env.DISCORD_BOT_TOKEN;

    if (!token) {
        console.error("❌ [BOT CRITICAL] DISCORD_BOT_TOKEN is missing from Render Environment!");
        return;
    }

    client.once('ready', () => {
        console.log(`✅ [BOT] Logged in as: ${client.user.tag}`);
        console.log(`✅ [BOT] Status: READY TO BACKUP`);

        // Schedule Daily Backup (11:59 PM)
        cron.schedule('59 23 * * *', () => {
            console.log("⏳ [BOT] Auto-Backup Triggered...");
            runBackup();
        }, { scheduled: true, timezone: "America/New_York" });
    });

    client.login(token).catch(err => {
        console.error("❌ [BOT] Login Failed:", err.message);
    });
}

async function runBackup() {
    // 1. WAIT FOR BOT TO BE READY (Retry for 10 seconds)
    if (!client.isReady()) {
        console.log("⚠️ [BOT] Not ready yet... waiting 5 seconds...");
        await new Promise(r => setTimeout(r, 5000));
        
        if (!client.isReady()) {
            throw new Error("Bot failed to connect to Discord after waiting. Check Token.");
        }
    }

    try {
        const channel = await client.channels.fetch(CHANNEL_ID);
        if (!channel) throw new Error(`Channel ${CHANNEL_ID} not found.`);

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
