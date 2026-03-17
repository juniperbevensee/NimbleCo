/**
 * Message Bus Logger
 *
 * Logs all NATS messages for analysis of inter-agent communication patterns.
 * Enables meta-cognitive analysis and study of emergent agent behaviors.
 */

import { NatsConnection, StringCodec, Msg } from 'nats';
import { Pool } from 'pg';

const sc = StringCodec();

export class MessageBusLogger {
  private nc: NatsConnection;
  private db: Pool;
  private enabled: boolean;
  private messageCount = 0;
  private errorCount = 0;

  constructor(nc: NatsConnection, db: Pool) {
    this.nc = nc;
    this.db = db;
    this.enabled = process.env.MESSAGE_BUS_LOGGING !== 'false'; // Default ON
  }

  async start() {
    if (!this.enabled) {
      console.log('📭 Message bus logging disabled');
      return;
    }

    console.log('📨 Starting message bus logger...');

    // Subscribe to ALL subjects with wildcard
    this.nc.subscribe('>', {
      callback: async (err, msg) => {
        if (err) {
          console.error('Message bus logger error:', err);
          return;
        }

        // Fire-and-forget: don't block operational messages
        this.logMessage(msg).catch(err => {
          this.errorCount++;
          if (this.errorCount % 10 === 0) {
            console.warn(`⚠️  Message bus logging errors: ${this.errorCount} total`);
          }
        });
      }
    });

    console.log('✅ Message bus logger started');

    // Log stats every 5 minutes
    setInterval(() => {
      if (this.messageCount > 0) {
        console.log(`📊 Message bus: ${this.messageCount} messages logged (${this.errorCount} errors)`);
      }
    }, 5 * 60 * 1000);
  }

  private async logMessage(msg: Msg) {
    let data: any;
    let sender: string | null = null;
    let recipient: string | null = null;
    let messageType: string | null = null;

    try {
      data = JSON.parse(sc.decode(msg.data));
    } catch (err) {
      // Not JSON, store as string
      data = { raw: sc.decode(msg.data) };
    }

    // Extract sender
    sender = this.extractSender(data);

    // Infer recipient from subject
    recipient = this.inferRecipient(msg.subject);

    // Classify message type
    messageType = this.classifyMessage(msg.subject, data);

    // Insert into database
    await this.db.query(
      `INSERT INTO message_bus_log (subject, data, sender, recipient, message_type)
       VALUES ($1, $2, $3, $4, $5)`,
      [msg.subject, JSON.stringify(data), sender, recipient, messageType]
    );

    this.messageCount++;
  }

  private extractSender(data: any): string | null {
    // Try common fields
    if (data.agent_id) return data.agent_id;
    if (data.user_id) return data.user_id;
    if (data.trigger_user_id) return data.trigger_user_id;
    if (data.mattermost_user) return data.mattermost_user;
    if (data.matrix_user) return data.matrix_user;
    if (data.payload?.mattermost_user) return data.payload.mattermost_user;
    if (data.payload?.matrix_user) return data.payload.matrix_user;
    return null;
  }

  private inferRecipient(subject: string): string | null {
    // Infer from NATS subject pattern
    if (subject.startsWith('tasks.')) {
      if (subject.includes('from-')) return 'coordinator';
      if (subject.includes('to-')) return subject.split('.')[2];
    }
    if (subject.startsWith('messages.')) {
      if (subject.includes('to-mattermost')) return 'mattermost-listener';
      if (subject.includes('to-matrix')) return 'matrix-listener';
    }
    if (subject.startsWith('agent.')) {
      const parts = subject.split('.');
      if (parts.length > 1) return parts[1]; // agent.{id}.{action}
    }
    return null;
  }

  private classifyMessage(subject: string, data: any): string | null {
    // Classify by subject
    if (subject.startsWith('tasks.')) {
      if (data.type) return `task:${data.type}`;
      return 'task';
    }
    if (subject.startsWith('messages.')) {
      if (data.is_final) return 'message:final';
      return 'message:update';
    }
    if (subject.startsWith('agent.')) {
      if (subject.includes('.response')) return 'agent:response';
      if (subject.includes('.status')) return 'agent:status';
      return 'agent:message';
    }
    if (subject.includes('swarm')) return 'swarm';

    return null;
  }

  stop() {
    if (this.messageCount > 0) {
      console.log(`📊 Message bus logger stopped: ${this.messageCount} messages logged`);
    }
  }
}
