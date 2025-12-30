const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
const mongoose = require('mongoose');
const cron = require('node-cron');

// --- CONFIGURATION ---
const CHANNEL_ID = "PASTE_YOUR_CHANNEL_ID_HERE"; 
// ---------------------

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

function startBot() {
    // SECURE: Grab token from Render/GitHub Environment Variables
    const token = process.env.DISCORD_BOT_TOKEN;

    if (!token) {
        console.log("⚠️ Bot skipped: Missing DISCORD_BOT_TOKEN in Environment Variables.");
        return;
    }

    client.once('ready', () => {
        console.log(`🤖 Backup Bot Online: ${client.user.tag}`);

        // SCHEDULE: RUNS EVERY MINUTE (FOR TESTING)
        cron.schedule('* * * * *', async () => {
            console.log("⏳ Starting 1-minute test backup...");
            await runBackup();
        }, {
            scheduled: true,
            timezone: "America/New_York"
        });
    });

    client.login(token);
}

async function runBackup() {
    try {
        const channel = await client.channels.fetch(CHANNEL_ID);
        if (!channel) return console.error("❌ Channel not found! Check ID in bot.js");

        const Player = mongoose.model('Player');
        
        // 1. Get all players
        const players = await Player.find({}, { _id: 0, __v: 0 });
        const jsonData = JSON.stringify(players, null, 2);
        
        // 2. Create backup file
        const buffer = Buffer.from(jsonData, 'utf-8');
        const dateStr = new Date().toISOString().replace(/:/g, '-'); // Safe filename
        const fileName = `GW_Backup_${dateStr}.json`;

        // 3. Send to Discord
        const attachment = new AttachmentBuilder(buffer, { name: fileName });
        await channel.send({ 
            content: `🛡️ **TEST BACKUP (1-Minute Interval)**\n📅 Time: ${dateStr}\n👥 Players: ${players.length}`, 
            files: [attachment] 
        });

        console.log("✅ Backup sent to Discord!");
    } catch (err) {
        console.error("❌ Backup Failed:", err);
    }
}

module.exports = { startBot };
