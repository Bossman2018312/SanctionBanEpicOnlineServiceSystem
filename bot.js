const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
const mongoose = require('mongoose');
const cron = require('node-cron');

// --- CONFIGURATION ---
const CHANNEL_ID = "1455641113447633027"; // <--- YOUR NEW ID
// ---------------------

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

function startBot() {
    console.log("🤖 [BOT] Initializing...");

    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) {
        console.error("❌ [BOT CRITICAL] DISCORD_BOT_TOKEN is missing from Environment Variables!");
        return;
    }

    client.once('ready', async () => {
        console.log(`✅ [BOT] Online as ${client.user.tag}`);
        
        // 1. TEST MESSAGE ON STARTUP
        try {
            const channel = await client.channels.fetch(CHANNEL_ID);
            if (channel) {
                console.log("✅ [BOT] Channel Found! Sending startup message...");
                await channel.send("🟢 **SYSTEM ONLINE** - Bot has connected successfully.");
            } else {
                console.error("❌ [BOT] Could not find channel! Check ID or Bot Permissions.");
            }
        } catch (e) {
            console.error("❌ [BOT] Error fetching channel on startup:", e.message);
        }

        // 2. SCHEDULE BACKUP (Every Minute)
        cron.schedule('* * * * *', async () => {
            console.log("⏳ [BOT] Starting 1-minute scheduled backup...");
            await runBackup();
        }, { scheduled: true, timezone: "America/New_York" });
    });

    client.login(token).catch(err => {
        console.error("❌ [BOT] Login Failed! Is the Token correct?", err.message);
    });
}

async function runBackup() {
    try {
        const channel = await client.channels.fetch(CHANNEL_ID);
        if (!channel) return console.error("❌ [BOT] Backup Failed: Channel not found.");

        // Fetch data
        const Player = mongoose.model('Player');
        const players = await Player.find({}, { _id: 0, __v: 0 });
        
        // Prepare File
        const jsonData = JSON.stringify(players, null, 2);
        const buffer = Buffer.from(jsonData, 'utf-8');
        const dateStr = new Date().toISOString().replace(/:/g, '-');
        const fileName = `GW_Backup_${dateStr}.json`;

        // Send
        const attachment = new AttachmentBuilder(buffer, { name: fileName });
        await channel.send({ 
            content: `🛡️ **DATABASE BACKUP**\n👥 Players Count: ${players.length}`, 
            files: [attachment] 
        });

        console.log("✅ [BOT] Backup sent successfully!");
    } catch (err) {
        console.error("❌ [BOT] Backup Error:", err);
    }
}

module.exports = { startBot };
