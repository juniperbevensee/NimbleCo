// Google Calendar tools - using service account authentication
// Matches the existing NimbleCo tool patterns

import { google } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
import { Tool, ToolContext } from '../base';
import type { calendar_v3 } from 'googleapis';

// Lazy-initialized context to avoid re-creating auth on every call
let cachedContext: { auth: GoogleAuth; calendar: calendar_v3.Calendar } | null = null;

/**
 * Get or create a Google Calendar client using service account credentials
 */
async function getCalendarClient(ctx: ToolContext): Promise<calendar_v3.Calendar> {
  // Check if we already have a cached client
  if (cachedContext) {
    return cachedContext.calendar;
  }

  // Get service account key from credentials
  const serviceAccountKeyJson = ctx.credentials.GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY ||
                                ctx.credentials.GOOGLE_CALENDAR_SERVICE_ACCOUNT_KEY;

  if (!serviceAccountKeyJson) {
    throw new Error(
      'Google Calendar credentials required. Set GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY (or GOOGLE_CALENDAR_SERVICE_ACCOUNT_KEY) environment variable.'
    );
  }

  let serviceAccountKey: any;
  try {
    serviceAccountKey = JSON.parse(serviceAccountKeyJson);
  } catch (e: any) {
    throw new Error(
      `Failed to parse service account key as JSON: ${e.message}\n` +
      `Hint: Make sure the JSON is not wrapped in extra quotes and has no escape issues.`
    );
  }

  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccountKey,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });

  const calendar = google.calendar({ version: 'v3', auth: auth as any });

  // Cache for reuse
  cachedContext = { auth, calendar };

  return calendar;
}

// Helper to convert Google API event to clean response format
function formatEvent(event: calendar_v3.Schema$Event) {
  return {
    id: event.id,
    summary: event.summary,
    description: event.description,
    location: event.location,
    start: event.start?.dateTime || event.start?.date,
    end: event.end?.dateTime || event.end?.date,
    timeZone: event.start?.timeZone,
    attendees: event.attendees?.map(a => ({
      email: a.email,
      name: a.displayName,
      responseStatus: a.responseStatus,
    })),
    htmlLink: event.htmlLink,
    status: event.status,
    created: event.created,
    updated: event.updated,
  };
}

export const googleCalendarListCalendars: Tool = {
  name: 'google_calendar_list_calendars',
  description: 'List all Google Calendar calendars accessible to the service account',
  category: 'calendar',
  requiredEnv: ['GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY'],
  use_cases: [
    'list available calendars',
    'find calendar ID',
    'check calendar access',
  ],
  parameters: {
    type: 'object',
    properties: {},
  },

  async handler(input, ctx: ToolContext) {
    try {
      const calendar = await getCalendarClient(ctx);
      const response = await calendar.calendarList.list();

      const calendars = (response.data.items || []).map(cal => ({
        id: cal.id,
        summary: cal.summary,
        description: cal.description,
        primary: cal.primary,
        accessRole: cal.accessRole,
        timeZone: cal.timeZone,
      }));

      return {
        success: true,
        calendars,
        count: calendars.length,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Google Calendar API error: ${error.message}`,
      };
    }
  },
};

export const googleCalendarListEvents: Tool = {
  name: 'google_calendar_list_events',
  description: 'List events from a Google Calendar with optional time range and search filters',
  category: 'calendar',
  requiredEnv: ['GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY'],
  use_cases: [
    'view upcoming events',
    'check schedule',
    'list meetings for date range',
    'search calendar events',
  ],
  parameters: {
    type: 'object',
    properties: {
      calendar_id: {
        type: 'string',
        description: 'Calendar ID (default: "primary")',
      },
      time_min: {
        type: 'string',
        description: 'Start of time range (ISO 8601, e.g., 2024-01-15T00:00:00Z)',
      },
      time_max: {
        type: 'string',
        description: 'End of time range (ISO 8601)',
      },
      max_results: {
        type: 'number',
        description: 'Maximum number of events to return (default: 50)',
      },
      query: {
        type: 'string',
        description: 'Free text search query',
      },
    },
  },

  async handler(input, ctx: ToolContext) {
    try {
      const calendar = await getCalendarClient(ctx);
      const response = await calendar.events.list({
        calendarId: input.calendar_id || 'primary',
        timeMin: input.time_min,
        timeMax: input.time_max,
        maxResults: input.max_results || 50,
        q: input.query,
        singleEvents: true,
        orderBy: 'startTime',
      });

      const events = (response.data.items || []).map(formatEvent);

      return {
        success: true,
        events,
        count: events.length,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Google Calendar API error: ${error.message}`,
      };
    }
  },
};

export const googleCalendarCreateEvent: Tool = {
  name: 'google_calendar_create_event',
  description: 'Create a new event in Google Calendar',
  category: 'calendar',
  requiredEnv: ['GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY'],
  use_cases: [
    'schedule meeting',
    'create calendar event',
    'book appointment',
    'add event to Google Calendar',
  ],
  parameters: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'Event title',
      },
      start: {
        type: 'string',
        description: 'Start time (ISO 8601, e.g., 2024-01-15T09:00:00-05:00)',
      },
      end: {
        type: 'string',
        description: 'End time (ISO 8601, e.g., 2024-01-15T10:00:00-05:00)',
      },
      description: {
        type: 'string',
        description: 'Event description',
      },
      location: {
        type: 'string',
        description: 'Event location or meeting URL',
      },
      attendees: {
        type: 'array',
        items: { type: 'string' },
        description: 'Email addresses of attendees',
      },
      calendar_id: {
        type: 'string',
        description: 'Calendar ID (default: "primary")',
      },
      time_zone: {
        type: 'string',
        description: 'Time zone (e.g., "America/New_York")',
      },
      send_notifications: {
        type: 'boolean',
        description: 'Send email notifications to attendees (default: false)',
      },
    },
    required: ['summary', 'start', 'end'],
  },

  async handler(input, ctx: ToolContext) {
    try {
      const calendar = await getCalendarClient(ctx);

      const eventBody: calendar_v3.Schema$Event = {
        summary: input.summary,
        description: input.description,
        location: input.location,
        start: {
          dateTime: input.start,
          timeZone: input.time_zone,
        },
        end: {
          dateTime: input.end,
          timeZone: input.time_zone,
        },
      };

      if (input.attendees && input.attendees.length > 0) {
        eventBody.attendees = input.attendees.map((email: string) => ({ email }));
      }

      const response = await calendar.events.insert({
        calendarId: input.calendar_id || 'primary',
        requestBody: eventBody,
        sendUpdates: input.send_notifications ? 'all' : 'none',
      });

      return {
        success: true,
        event: formatEvent(response.data),
        message: `Event created: ${input.summary}`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Google Calendar API error: ${error.message}`,
      };
    }
  },
};

export const googleCalendarUpdateEvent: Tool = {
  name: 'google_calendar_update_event',
  description: 'Update an existing event in Google Calendar',
  category: 'calendar',
  requiredEnv: ['GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY'],
  use_cases: [
    'reschedule meeting',
    'change event details',
    'update meeting time',
    'modify calendar event',
  ],
  parameters: {
    type: 'object',
    properties: {
      event_id: {
        type: 'string',
        description: 'Event ID to update',
      },
      calendar_id: {
        type: 'string',
        description: 'Calendar ID (default: "primary")',
      },
      summary: {
        type: 'string',
        description: 'New event title',
      },
      start: {
        type: 'string',
        description: 'New start time (ISO 8601)',
      },
      end: {
        type: 'string',
        description: 'New end time (ISO 8601)',
      },
      description: {
        type: 'string',
        description: 'New description',
      },
      location: {
        type: 'string',
        description: 'New location',
      },
      attendees: {
        type: 'array',
        items: { type: 'string' },
        description: 'New attendees list (replaces existing)',
      },
      time_zone: {
        type: 'string',
        description: 'Time zone',
      },
      send_notifications: {
        type: 'boolean',
        description: 'Send email notifications to attendees',
      },
    },
    required: ['event_id'],
  },

  async handler(input, ctx: ToolContext) {
    try {
      const calendar = await getCalendarClient(ctx);
      const calendarId = input.calendar_id || 'primary';

      // Get existing event first
      const existing = await calendar.events.get({
        calendarId,
        eventId: input.event_id,
      });

      const eventBody: calendar_v3.Schema$Event = { ...existing.data };

      if (input.summary !== undefined) eventBody.summary = input.summary;
      if (input.description !== undefined) eventBody.description = input.description;
      if (input.location !== undefined) eventBody.location = input.location;
      if (input.start !== undefined) {
        eventBody.start = {
          dateTime: input.start,
          timeZone: input.time_zone || existing.data.start?.timeZone,
        };
      }
      if (input.end !== undefined) {
        eventBody.end = {
          dateTime: input.end,
          timeZone: input.time_zone || existing.data.end?.timeZone,
        };
      }
      if (input.attendees !== undefined) {
        eventBody.attendees = input.attendees.map((email: string) => ({ email }));
      }

      const response = await calendar.events.update({
        calendarId,
        eventId: input.event_id,
        requestBody: eventBody,
        sendUpdates: input.send_notifications ? 'all' : 'none',
      });

      return {
        success: true,
        event: formatEvent(response.data),
        message: `Event updated: ${response.data.summary}`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Google Calendar API error: ${error.message}`,
      };
    }
  },
};

export const googleCalendarDeleteEvent: Tool = {
  name: 'google_calendar_delete_event',
  description: 'Delete an event from Google Calendar',
  category: 'calendar',
  requiredEnv: ['GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY'],
  use_cases: [
    'cancel meeting',
    'delete calendar event',
    'remove appointment',
  ],
  parameters: {
    type: 'object',
    properties: {
      event_id: {
        type: 'string',
        description: 'Event ID to delete',
      },
      calendar_id: {
        type: 'string',
        description: 'Calendar ID (default: "primary")',
      },
      send_notifications: {
        type: 'boolean',
        description: 'Send cancellation notifications to attendees',
      },
    },
    required: ['event_id'],
  },

  async handler(input, ctx: ToolContext) {
    try {
      const calendar = await getCalendarClient(ctx);

      await calendar.events.delete({
        calendarId: input.calendar_id || 'primary',
        eventId: input.event_id,
        sendUpdates: input.send_notifications ? 'all' : 'none',
      });

      return {
        success: true,
        message: `Event deleted: ${input.event_id}`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Google Calendar API error: ${error.message}`,
      };
    }
  },
};

export const googleCalendarQuickAdd: Tool = {
  name: 'google_calendar_quick_add',
  description: 'Create a calendar event using natural language (e.g., "Meeting with John tomorrow at 3pm")',
  category: 'calendar',
  requiredEnv: ['GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY'],
  use_cases: [
    'quick add event',
    'natural language calendar',
    'fast event creation',
  ],
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'Natural language event description (e.g., "Team standup tomorrow at 9am for 30 minutes")',
      },
      calendar_id: {
        type: 'string',
        description: 'Calendar ID (default: "primary")',
      },
    },
    required: ['text'],
  },

  async handler(input, ctx: ToolContext) {
    try {
      const calendar = await getCalendarClient(ctx);

      const response = await calendar.events.quickAdd({
        calendarId: input.calendar_id || 'primary',
        text: input.text,
      });

      return {
        success: true,
        event: formatEvent(response.data),
        message: `Event created from: "${input.text}"`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Google Calendar API error: ${error.message}`,
      };
    }
  },
};

export const googleCalendarTools = [
  googleCalendarListCalendars,
  googleCalendarListEvents,
  googleCalendarCreateEvent,
  googleCalendarUpdateEvent,
  googleCalendarDeleteEvent,
  googleCalendarQuickAdd,
];
