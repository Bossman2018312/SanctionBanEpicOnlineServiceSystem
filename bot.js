const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
const mongoose = require('mongoose');
const cron = require('node-cron');

// --- CONFIGURATION ---
const BOT_TOKEN = "MTQ1NTY4Mzc1OTgxMzgyMDY1MQ.GQWVWE.yrDU1XtEt-N54kq9IApom7oW3OZsZAuzKkscAs";
const CHANNEL_ID = "1455641113447633027";
// ---------------------

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

function startBot() {
    client.once('ready', () => {
        console.log(`🤖 Backup Bot Online: ${client.user.tag}`);

        // SCHEDULE: 11:59 PM EST Daily
        cron.schedule('59 23 * * *', async () => {
            console.log("⏳ Starting scheduled backup...");
            await runBackup();
        }, {
            scheduled: true,
            timezone: "America/New_York"
        });
    });

    client.login(BOT_TOKEN);
}

async function runBackup() {
    try {
        const channel = await client.channels.fetch(CHANNEL_ID);
        if (!channel) return console.error("❌ Channel not found!");

        // 1. Fetch all players using the model defined in server.js
        // We use mongoose.model('Player') because server.js already defined it
        const Player = mongoose.model('Player');
        const players = await Player.find({}, { _id: 0, __v: 0 }); // Exclude internal Mongo IDs
        
        const jsonData = JSON.stringify(players, null, 2);
        
        // 2. Create Buffer
        const buffer = Buffer.from(jsonData, 'utf-8');
        const dateStr = new Date().toISOString().split('T')[0];
        const fileName = `GW_Backup_${dateStr}.json`;

        // 3. Send to Discord
        const attachment = new AttachmentBuilder(buffer, { name: fileName });
        await channel.send({ 
            content: `🛡️ **DAILY DATABASE BACKUP**\n📅 Date: ${dateStr}\n👥 Players: ${players.length}`, 
            files: [attachment] 
        });

        console.log("✅ Backup sent to Discord!");
    } catch (err) {
        console.error("❌ Backup Failed:", err);
    }
}

module.exports = { startBot };
