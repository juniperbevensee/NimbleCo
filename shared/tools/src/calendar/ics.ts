// GREEN: Implement to pass tests
import { Tool, ToolContext } from '../base';
import ical from 'ical-generator';
import * as fs from 'fs/promises';
import * as path from 'path';

interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  description?: string;
  location?: string;
  attendees?: string[];
}

// In-memory event store (could be moved to PostgreSQL later)
export class CalendarStore {
  private static events = new Map<string, CalendarEvent>();

  static set(id: string, event: CalendarEvent) {
    this.events.set(id, event);
  }

  static get(id: string): CalendarEvent | undefined {
    return this.events.get(id);
  }

  static delete(id: string): boolean {
    return this.events.delete(id);
  }

  static values(): IterableIterator<CalendarEvent> {
    return this.events.values();
  }

  static clear() {
    this.events.clear();
  }
}

function generateEventId(): string {
  return `event-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

function getCalendarPath(ctx: ToolContext): string {
  const storagePath = ctx.credentials.CALENDAR_STORAGE_PATH || './tmp/calendar';
  return path.join(storagePath, 'team.ics');
}

async function regenerateCalendar(ctx: ToolContext): Promise<void> {
  const calendar = ical({
    name: 'NimbleCo Team Calendar',
    description: 'Shared team events and deadlines',
    timezone: 'UTC',
    prodId: '//NimbleCo//Calendar//EN',
  });

  // Add all events
  for (const event of CalendarStore.values()) {
    const eventData: any = {
      id: event.id,
      start: event.start,
      end: event.end,
      summary: event.title,
      description: event.description,
      location: event.location,
      organizer: {
        name: 'NimbleCo Bot',
        email: 'bot@nimbleco.local',
      },
    };

    // Only add attendees if they exist
    if (event.attendees && event.attendees.length > 0) {
      eventData.attendees = event.attendees.map(email => ({
        email,
        name: email.split('@')[0], // Extract name from email
      }));
    }

    calendar.createEvent(eventData);
  }

  const icsContent = calendar.toString();

  // Write to file
  const calendarPath = getCalendarPath(ctx);
  await fs.mkdir(path.dirname(calendarPath), { recursive: true });
  await fs.writeFile(calendarPath, icsContent, 'utf-8');
}

function getCalendarUrl(ctx: ToolContext): string {
  // If using MinIO/S3, return public URL
  if (ctx.credentials.MINIO_ENDPOINT) {
    const endpoint = ctx.credentials.MINIO_ENDPOINT;
    const bucket = ctx.credentials.MINIO_BUCKET || 'nimbleco';
    return `${endpoint}/${bucket}/calendars/team.ics`;
  }

  // Otherwise return local file path (for testing)
  return `file://${getCalendarPath(ctx)}`;
}

export const createCalendarEvent: Tool = {
  name: 'create_calendar_event',
  description: 'Create a calendar event. Updates the team ICS feed automatically. All times must be in ISO 8601 format (e.g., 2024-01-15T09:00:00Z).',
  category: 'calendar',
  use_cases: [
    'schedule meeting',
    'create deadline',
    'book time',
    'add event to calendar',
  ],
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Event title',
      },
      start_time: {
        type: 'string',
        description: 'Start time (ISO 8601 format, e.g., 2024-01-15T09:00:00Z)',
      },
      end_time: {
        type: 'string',
        description: 'End time (ISO 8601 format, e.g., 2024-01-15T10:00:00Z)',
      },
      description: {
        type: 'string',
        description: 'Event description',
      },
      location: {
        type: 'string',
        description: 'Location or meeting URL (e.g., Jitsi link)',
      },
      attendees: {
        type: 'array',
        items: { type: 'string' },
        description: 'Email addresses of attendees',
      },
    },
    required: ['title', 'start_time', 'end_time'],
  },

  async handler(input, ctx: ToolContext) {
    try {
      const startDate = new Date(input.start_time);
      const endDate = new Date(input.end_time);

      // Validate dates
      if (isNaN(startDate.getTime())) {
        return {
          success: false,
          error: 'Invalid date format for start_time. Use ISO 8601 (e.g., 2024-01-15T09:00:00Z)',
        };
      }

      if (isNaN(endDate.getTime())) {
        return {
          success: false,
          error: 'Invalid date format for end_time. Use ISO 8601 (e.g., 2024-01-15T10:00:00Z)',
        };
      }

      if (endDate <= startDate) {
        return {
          success: false,
          error: 'End time must be after start time',
        };
      }

      const event: CalendarEvent = {
        id: generateEventId(),
        title: input.title,
        start: startDate,
        end: endDate,
        description: input.description,
        location: input.location,
        attendees: input.attendees,
      };

      CalendarStore.set(event.id, event);
      await regenerateCalendar(ctx);

      return {
        success: true,
        event_id: event.id,
        calendar_url: getCalendarUrl(ctx),
        message: `Event created: ${event.title}`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to create event: ${error.message}`,
      };
    }
  },
};

export const updateCalendarEvent: Tool = {
  name: 'update_calendar_event',
  description: 'Update an existing calendar event. Only specified fields will be updated.',
  category: 'calendar',
  use_cases: [
    'reschedule meeting',
    'change event details',
    'update meeting time',
  ],
  parameters: {
    type: 'object',
    properties: {
      event_id: {
        type: 'string',
        description: 'Event ID to update',
      },
      title: {
        type: 'string',
        description: 'New event title',
      },
      start_time: {
        type: 'string',
        description: 'New start time (ISO 8601)',
      },
      end_time: {
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
    },
    required: ['event_id'],
  },

  async handler(input, ctx: ToolContext) {
    try {
      const event = CalendarStore.get(input.event_id);

      if (!event) {
        return {
          success: false,
          error: `Event not found: ${input.event_id}`,
        };
      }

      // Update fields
      if (input.title !== undefined) event.title = input.title;
      if (input.description !== undefined) event.description = input.description;
      if (input.location !== undefined) event.location = input.location;

      if (input.start_time !== undefined) {
        const startDate = new Date(input.start_time);
        if (isNaN(startDate.getTime())) {
          return { success: false, error: 'Invalid start_time format' };
        }
        event.start = startDate;
      }

      if (input.end_time !== undefined) {
        const endDate = new Date(input.end_time);
        if (isNaN(endDate.getTime())) {
          return { success: false, error: 'Invalid end_time format' };
        }
        event.end = endDate;
      }

      // Validate end > start
      if (event.end <= event.start) {
        return {
          success: false,
          error: 'End time must be after start time',
        };
      }

      CalendarStore.set(event.id, event);
      await regenerateCalendar(ctx);

      return {
        success: true,
        event_id: event.id,
        message: `Event updated: ${event.title}`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to update event: ${error.message}`,
      };
    }
  },
};

export const deleteCalendarEvent: Tool = {
  name: 'delete_calendar_event',
  description: 'Delete a calendar event',
  category: 'calendar',
  use_cases: [
    'cancel meeting',
    'remove event',
    'delete appointment',
  ],
  parameters: {
    type: 'object',
    properties: {
      event_id: {
        type: 'string',
        description: 'Event ID to delete',
      },
    },
    required: ['event_id'],
  },

  async handler(input, ctx: ToolContext) {
    try {
      const event = CalendarStore.get(input.event_id);

      if (!event) {
        return {
          success: false,
          error: `Event not found: ${input.event_id}`,
        };
      }

      const title = event.title;
      CalendarStore.delete(input.event_id);
      await regenerateCalendar(ctx);

      return {
        success: true,
        message: `Event deleted: ${title}`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to delete event: ${error.message}`,
      };
    }
  },
};

export const getCalendarSubscriptionUrl: Tool = {
  name: 'get_calendar_url',
  description: 'Get the subscription URL for the team calendar. Users can add this to their calendar app to auto-sync events.',
  category: 'calendar',
  use_cases: [
    'subscribe to calendar',
    'get calendar link',
    'calendar subscription',
  ],
  parameters: {
    type: 'object',
    properties: {},
  },

  async handler(input, ctx: ToolContext) {
    return {
      success: true,
      calendar_url: getCalendarUrl(ctx),
      instructions: [
        'Copy the URL above',
        'In your calendar app:',
        '  • Apple Calendar: File > New Calendar Subscription',
        '  • Google Calendar: Add calendar > From URL',
        '  • Thunderbird: Right-click Calendars > New Calendar > Network',
        'Paste the URL and save',
        'Calendar will auto-update every 15-30 minutes',
      ].join('\n'),
    };
  },
};

export const icsCalendarTools = [
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  getCalendarSubscriptionUrl,
];
