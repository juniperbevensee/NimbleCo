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
  description: 'Send a message to another agent in the swarm. Use this to communicate, ask questions, share insights, or coordinate with other agents.',
  use_cases: [
    'Communicating with other agents in a swarm',
    'Asking questions to other agents',
    'Sharing information or insights',
    'Coordinating multi-agent tasks',
    'Conversational exchanges between agents',
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
