/**
 * Inter-Agent Communication Tools
 *
 * Enables agents in swarms to communicate directly with each other.
 * All messages are logged in the message bus for analysis.
 */
import { Tool, ToolContext } from '../base';
import { NatsConnection, StringCodec } from 'nats';

const sc = StringCodec();

// Store NATS connection (will be injected by the agent)
let natsConnection: NatsConnection | null = null;

export function setNatsConnection(nc: NatsConnection) {
  natsConnection = nc;
}

export const sendMessageToAgent: Tool = {
  name: 'send_message_to_agent',
  description: 'Send a backend message to another agent working on the SAME TASK in a swarm. ONLY for inter-agent coordination, NOT for Mattermost chat. To talk to other bots in Mattermost, just @mention them in your response text like "@botname hello".',
  use_cases: [
    'Backend coordination with agents in the same swarm task',
    'Asking questions to co-workers on the same task',
    'Sharing task-specific information between swarm members',
    'NOT for Mattermost chat - use @mentions for that',
  ],
  category: 'communication',
  parameters: {
    type: 'object',
    properties: {
      recipient_agent_id: {
        type: 'string',
        description: 'The ID of the agent to send the message to',
      },
      message: {
        type: 'string',
        description: 'The message content to send',
      },
    },
    required: ['recipient_agent_id', 'message'],
  },
  async handler(params: any, context: ToolContext): Promise<any> {
    const { recipient_agent_id, message } = params;

    if (!natsConnection) {
      throw new Error('NATS connection not configured for inter-agent messaging');
    }

    // Publish to recipient's inbox
    const messageData = {
      from: context.agent_id || 'unknown',
      to: recipient_agent_id,
      message,
      timestamp: new Date().toISOString(),
    };

    natsConnection.publish(
      `agent.${recipient_agent_id}.inbox`,
      sc.encode(JSON.stringify(messageData))
    );

    return {
      success: true,
      recipient: recipient_agent_id,
      message: 'Message sent successfully',
    };
  },
};

export const interAgentTools = [sendMessageToAgent];
