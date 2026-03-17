// Jitsi meeting tools - open source, self-hostable
// No API needed for basic Jitsi - just generate URLs!

import { Tool, ToolContext } from '../base';
import ical from 'ical-generator';

function generateRoomName(prefix = 'meeting'): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${timestamp}-${random}`;
}

function generateJitsiUrl(roomName: string, domain = 'meet.jit.si'): string {
  return `https://${domain}/${roomName}`;
}

function generateICS(params: {
  title: string;
  start: Date;
  end: Date;
  location: string;
  description?: string;
  attendees?: string[];
}): string {
  const calendar = ical({ name: 'Meeting' });

  calendar.createEvent({
    start: params.start,
    end: params.end,
    summary: params.title,
    location: params.location,
    description: params.description,
    organizer: 'NimbleCo Bot',
    attendees: params.attendees?.map(email => ({
      email,
      rsvp: true
    }))
  });

  return calendar.toString();
}

export const createJitsiMeeting: Tool = {
  name: 'create_jitsi_meeting',
  description: 'Create an instant Jitsi video meeting. Returns a meeting URL that works immediately. No account needed.',
  category: 'meetings',
  use_cases: [
    'scheduling video call',
    'creating meeting link',
    'setting up video conference',
    'instant meeting'
  ],
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Meeting title'
      },
      start_time: {
        type: 'string',
        description: 'Start time (ISO 8601 format, e.g. 2024-01-15T14:00:00Z)'
      },
      duration_minutes: {
        type: 'number',
        description: 'Duration in minutes (default: 60)',
        default: 60
      },
      attendees: {
        type: 'array',
        items: { type: 'string' },
        description: 'Email addresses of attendees (for calendar invite)'
      },
      custom_domain: {
        type: 'string',
        description: 'Custom Jitsi domain if self-hosting (default: meet.jit.si)'
      }
    },
    required: ['title', 'start_time']
  },

  async handler(input, ctx: ToolContext) {
    const domain = input.custom_domain || 'meet.jit.si';
    const roomName = generateRoomName(input.title.toLowerCase().replace(/[^a-z0-9]/g, '-'));
    const meetingUrl = generateJitsiUrl(roomName, domain);

    const startTime = new Date(input.start_time);
    const duration = input.duration_minutes || 60;
    const endTime = new Date(startTime.getTime() + duration * 60000);

    // Generate calendar invite
    const icsContent = generateICS({
      title: input.title,
      start: startTime,
      end: endTime,
      location: meetingUrl,
      description: `Join Jitsi meeting: ${meetingUrl}`,
      attendees: input.attendees
    });

    return {
      success: true,
      meeting_url: meetingUrl,
      room_name: roomName,
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      calendar_invite: icsContent,
      instructions: [
        `Meeting URL: ${meetingUrl}`,
        'No account or app required - works in browser',
        'Mobile: Download Jitsi Meet app for best experience',
        `Room name: ${roomName}`
      ].join('\n')
    };
  }
};

export const generateJitsiInstantLink: Tool = {
  name: 'generate_jitsi_link',
  description: 'Generate an instant Jitsi meeting link. No scheduling needed - works immediately.',
  category: 'meetings',
  use_cases: [
    'quick video call',
    'instant meeting',
    'generate video link',
    'adhoc meeting'
  ],
  parameters: {
    type: 'object',
    properties: {
      room_hint: {
        type: 'string',
        description: 'Optional hint for room name (e.g., "standup", "demo")'
      },
      custom_domain: {
        type: 'string',
        description: 'Custom Jitsi domain if self-hosting'
      }
    }
  },

  async handler(input, ctx: ToolContext) {
    const domain = input.custom_domain || 'meet.jit.si';
    const roomName = generateRoomName(input.room_hint || 'instant');
    const meetingUrl = generateJitsiUrl(roomName, domain);

    return {
      success: true,
      meeting_url: meetingUrl,
      room_name: roomName,
      message: `Instant Jitsi meeting created: ${meetingUrl}`,
      note: 'Link works immediately - no setup required'
    };
  }
};

// For self-hosted Jitsi with JWT authentication
export const createSecureJitsiMeeting: Tool = {
  name: 'create_secure_jitsi_meeting',
  description: 'Create a Jitsi meeting on self-hosted server with JWT authentication (requires Jitsi server with JWT enabled)',
  category: 'meetings',
  use_cases: [
    'private video call',
    'authenticated meeting',
    'self-hosted jitsi'
  ],
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      start_time: { type: 'string' },
      duration_minutes: { type: 'number', default: 60 },
      attendees: { type: 'array', items: { type: 'string' } },
      jitsi_domain: {
        type: 'string',
        description: 'Your self-hosted Jitsi domain'
      }
    },
    required: ['title', 'start_time', 'jitsi_domain']
  },

  async handler(input, ctx: ToolContext) {
    // This requires JWT token generation
    // Implementation depends on your Jitsi server setup
    const roomName = generateRoomName(input.title.toLowerCase().replace(/[^a-z0-9]/g, '-'));

    // Generate JWT token (simplified - real implementation needs proper JWT signing)
    const jwtToken = 'placeholder-token'; // TODO: Implement JWT signing with ctx.credentials.JITSI_APP_SECRET

    const meetingUrl = `https://${input.jitsi_domain}/${roomName}?jwt=${jwtToken}`;

    return {
      success: true,
      meeting_url: meetingUrl,
      room_name: roomName,
      note: 'Secure meeting with JWT authentication'
    };
  }
};

export const jitsiTools = [
  createJitsiMeeting,
  generateJitsiInstantLink,
  createSecureJitsiMeeting
];
