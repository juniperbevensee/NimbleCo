#!/usr/bin/env node
/**
 * Mattermost Bot Setup Helper
 *
 * This script helps you add the bot to a channel and get the channel ID.
 *
 * Prerequisites:
 * 1. Create a channel in Mattermost (e.g., #agent-tasks)
 * 2. The bot should already exist (created via System Console)
 */

import * as dotenv from 'dotenv';
dotenv.config();

const MATTERMOST_URL = process.env.MATTERMOST_URL || 'http://localhost:8065';
const BOT_TOKEN = process.env.MATTERMOST_BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('❌ MATTERMOST_BOT_TOKEN not found in .env file');
  process.exit(1);
}

interface Team {
  id: string;
  name: string;
  display_name: string;
}

interface Channel {
  id: string;
  name: string;
  display_name: string;
  team_id: string;
}

interface User {
  id: string;
  username: string;
}

async function mmFetch(endpoint: string, options: any = {}) {
  const response = await fetch(`${MATTERMOST_URL}/api/v4${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${BOT_TOKEN}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Mattermost API error: ${response.status} - ${error}`);
  }

  return response.json();
}

async function getBotUser(): Promise<User> {
  return await mmFetch('/users/me');
}

async function getTeams(): Promise<Team[]> {
  return await mmFetch('/teams');
}

async function findChannel(teamId: string, channelName: string): Promise<Channel | null> {
  try {
    return await mmFetch(`/teams/${teamId}/channels/name/${channelName}`);
  } catch {
    return null;
  }
}

async function addBotToTeam(teamId: string, botUserId: string): Promise<void> {
  await mmFetch(`/teams/${teamId}/members`, {
    method: 'POST',
    body: JSON.stringify({
      team_id: teamId,
      user_id: botUserId,
    }),
  });
}

async function addBotToChannel(channelId: string, botUserId: string): Promise<void> {
  await mmFetch(`/channels/${channelId}/members`, {
    method: 'POST',
    body: JSON.stringify({
      user_id: botUserId,
    }),
  });
}

async function main() {
  console.log('🤖 Mattermost Bot Setup\n');

  try {
    // Step 1: Get bot info
    const botUser = await getBotUser();
    console.log(`✅ Connected as: ${botUser.username}`);
    console.log(`   Bot ID: ${botUser.id}\n`);

    // Step 2: Get teams
    const teams = await getTeams();
    console.log('📋 Available teams:');
    teams.forEach((team, i) => {
      console.log(`   ${i + 1}. ${team.display_name} (${team.name})`);
    });

    if (teams.length === 0) {
      console.error('\n❌ No teams found. Create a team in Mattermost first.');
      process.exit(1);
    }

    // Use first team
    const team = teams[0];
    console.log(`\n✅ Using team: ${team.display_name}\n`);

    // Step 3: Get desired channel name from env or use default
    const channelName = process.env.MATTERMOST_CHANNEL || 'agent-tasks';
    console.log(`🔍 Looking for channel: #${channelName}`);

    let channel = await findChannel(team.id, channelName);

    if (!channel) {
      console.log(`\n❌ Channel #${channelName} doesn't exist.`);
      console.log(`\nTo create it:`);
      console.log(`1. Open Mattermost: ${MATTERMOST_URL}`);
      console.log(`2. Click the + next to "PUBLIC CHANNELS"`);
      console.log(`3. Create a channel named "${channelName}"`);
      console.log(`4. Run this script again`);
      process.exit(1);
    }

    console.log(`   ✅ Channel found!`);

    // Step 4: Add bot to team first (required before adding to channel)
    console.log(`\n🔧 Adding bot to team ${team.display_name}...`);
    try {
      await addBotToTeam(team.id, botUser.id);
      console.log(`   ✅ Bot added to team!`);
    } catch (error: any) {
      if (error.message.includes('409')) {
        console.log(`   ℹ️  Bot already in team`);
      } else {
        console.error(`   ❌ Failed to add bot to team:`, error.message);
        throw error;
      }
    }

    // Step 5: Add bot to channel
    console.log(`\n🔧 Adding bot to #${channelName}...`);
    try {
      await addBotToChannel(channel.id, botUser.id);
      console.log(`   ✅ Bot added to channel!`);
    } catch (error: any) {
      if (error.message.includes('409')) {
        console.log(`   ℹ️  Bot already in channel`);
      } else {
        throw error;
      }
    }

    // Step 6: Show results
    console.log(`\n${'='.repeat(60)}`);
    console.log('✅ Setup Complete!');
    console.log(`${'='.repeat(60)}`);
    console.log(`\nYour bot is ready! Add these to your .env file:\n`);
    console.log(`MATTERMOST_CHANNEL_ID=${channel.id}`);
    console.log(`MATTERMOST_TEAM_ID=${team.id}`);
    console.log(`\nBot @${botUser.username} is now in #${channelName}`);
    console.log(`\nRestart the coordinator to start the listener:`);
    console.log(`  npm run build && npx pm2 restart coordinator`);
    console.log(`\nThen you can @mention the bot in #${channelName}!`);

  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  }
}

main();
