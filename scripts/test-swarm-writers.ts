#!/usr/bin/env ts-node
/**
 * Test Script: 3 Famous Writers Swarm
 *
 * Spawns 3 agents (Emily Dickinson, James Baldwin, Edgar Allan Poe)
 * They can communicate with each other for 20 turns using send_message_to_agent tool.
 * All messages are logged in the message bus for analysis.
 *
 * Usage:
 *   ts-node scripts/test-swarm-writers.ts
 *
 * Then analyze:
 *   Ask Audrey: "analyze the message bus for the last hour, filter by inter-agent messages"
 */

import { connect, StringCodec } from 'nats';

const sc = StringCodec();

async function main() {
  console.log('📚 Spawning 3 Famous Writer Agents\n');

  // Connect to NATS
  const nc = await connect({ servers: process.env.NATS_URL || 'nats://localhost:4222' });
  console.log('✅ Connected to NATS\n');

  // Define the swarm roster
  const agents = [
    {
      agent_id: 'emily-dickinson',
      role: 'Emily Dickinson',
      description: 'American poet known for introspective, deeply personal poetry',
    },
    {
      agent_id: 'james-baldwin',
      role: 'James Baldwin',
      description: 'American novelist and social critic, exploring race, sexuality, and class',
    },
    {
      agent_id: 'edgar-allan-poe',
      role: 'Edgar Allan Poe',
      description: 'Master of Gothic horror and psychological thriller',
    },
  ];

  // Spawn each agent with swarm roster
  for (const agent of agents) {
    const task = {
      task_id: `${Date.now()}-${agent.agent_id}`,
      role: agent.role,
      instructions: `You are ${agent.role}. You are participating in a literary discussion with ${agents.filter(a => a.agent_id !== agent.agent_id).map(a => a.role).join(' and ')}.

Engage in thoughtful conversation about:
- Your writing style and philosophy
- Your views on art, death, love, or social issues
- Questions or comments on the others' work

Use the send_message_to_agent tool to communicate with the other writers. Be authentic to your historical voice and perspective.`,
      tools: ['send_message_to_agent'], // Give them the messaging tool
      model: 'complex',
      swarm_roster: agents.filter(a => a.agent_id !== agent.agent_id), // Other agents
      max_turns: 20,
    };

    nc.publish('tasks.agent-universal', sc.encode(JSON.stringify(task)));
    console.log(`✅ Spawned: ${agent.role} (${agent.agent_id})`);
  }

  console.log('\n📨 Agents are now active. They will communicate via the message bus.');
  console.log('💬 Watch the message bus logs to see their conversation.');
  console.log('\n🔬 To analyze their communication patterns:');
  console.log('   Ask @audrey: "analyze the message bus for the last hour"');

  await nc.close();
  console.log('\n✅ Swarm launched!');
}

main().catch(console.error);
