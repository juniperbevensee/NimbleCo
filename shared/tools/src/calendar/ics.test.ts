// RED: Write failing tests first
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  getCalendarSubscriptionUrl,
  CalendarStore,
} from './ics';
import { ToolContext } from '../base';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('ICS Calendar Tools', () => {
  let testContext: ToolContext;
  let testDir: string;

  beforeEach(async () => {
    // Setup test environment
    testDir = path.join(process.cwd(), 'tmp', 'test-calendar');
    await fs.mkdir(testDir, { recursive: true });

    testContext = {
      user_id: 'test-user',
      platform: 'mattermost',
      credentials: {
        CALENDAR_STORAGE_PATH: testDir,
      },
    };

    // Reset store
    CalendarStore.clear();
  });

  afterEach(async () => {
    // Cleanup
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('createCalendarEvent', () => {
    it('should create a calendar event', async () => {
      const result = await createCalendarEvent.handler(
        {
          title: 'Team Standup',
          start_time: '2024-01-15T09:00:00Z',
          end_time: '2024-01-15T09:30:00Z',
          description: 'Daily standup meeting',
          location: 'https://meet.jit.si/standup',
        },
        testContext
      );

      expect(result.success).toBe(true);
      expect(result.event_id).toBeDefined();
      expect(result.calendar_url).toContain('.ics');
    });

    it('should reject invalid date format', async () => {
      const result = await createCalendarEvent.handler(
        {
          title: 'Test Event',
          start_time: 'invalid-date',
          end_time: '2024-01-15T10:00:00Z',
        },
        testContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid date');
    });

    it('should reject end time before start time', async () => {
      const result = await createCalendarEvent.handler(
        {
          title: 'Test Event',
          start_time: '2024-01-15T10:00:00Z',
          end_time: '2024-01-15T09:00:00Z',
        },
        testContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('after start');
    });

    it('should generate valid ICS file', async () => {
      await createCalendarEvent.handler(
        {
          title: 'Test Event',
          start_time: '2024-01-15T09:00:00Z',
          end_time: '2024-01-15T10:00:00Z',
        },
        testContext
      );

      const icsPath = path.join(testDir, 'team.ics');
      const icsContent = await fs.readFile(icsPath, 'utf-8');

      expect(icsContent).toContain('BEGIN:VCALENDAR');
      expect(icsContent).toContain('BEGIN:VEVENT');
      expect(icsContent).toContain('SUMMARY:Test Event');
      expect(icsContent).toContain('END:VEVENT');
      expect(icsContent).toContain('END:VCALENDAR');
    });

    it('should add attendees to event', async () => {
      await createCalendarEvent.handler(
        {
          title: 'Team Meeting',
          start_time: '2024-01-15T14:00:00Z',
          end_time: '2024-01-15T15:00:00Z',
          attendees: ['alice@example.com', 'bob@example.com'],
        },
        testContext
      );

      const icsPath = path.join(testDir, 'team.ics');
      const icsContent = await fs.readFile(icsPath, 'utf-8');

      expect(icsContent).toContain('ATTENDEE');
      expect(icsContent).toContain('alice@example.com');
      expect(icsContent).toContain('bob@example.com');
    });
  });

  describe('updateCalendarEvent', () => {
    it('should update an existing event', async () => {
      const createResult = await createCalendarEvent.handler(
        {
          title: 'Original Title',
          start_time: '2024-01-15T09:00:00Z',
          end_time: '2024-01-15T10:00:00Z',
        },
        testContext
      );

      const updateResult = await updateCalendarEvent.handler(
        {
          event_id: createResult.event_id,
          title: 'Updated Title',
        },
        testContext
      );

      expect(updateResult.success).toBe(true);

      const icsPath = path.join(testDir, 'team.ics');
      const icsContent = await fs.readFile(icsPath, 'utf-8');
      expect(icsContent).toContain('Updated Title');
      expect(icsContent).not.toContain('Original Title');
    });

    it('should reject update for non-existent event', async () => {
      const result = await updateCalendarEvent.handler(
        {
          event_id: 'non-existent-id',
          title: 'Updated Title',
        },
        testContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should update only specified fields', async () => {
      const createResult = await createCalendarEvent.handler(
        {
          title: 'Original',
          start_time: '2024-01-15T09:00:00Z',
          end_time: '2024-01-15T10:00:00Z',
          location: 'Original Location',
        },
        testContext
      );

      await updateCalendarEvent.handler(
        {
          event_id: createResult.event_id,
          location: 'New Location',
        },
        testContext
      );

      const icsPath = path.join(testDir, 'team.ics');
      const icsContent = await fs.readFile(icsPath, 'utf-8');
      expect(icsContent).toContain('Original');
      expect(icsContent).toContain('New Location');
    });
  });

  describe('deleteCalendarEvent', () => {
    it('should delete an event', async () => {
      const createResult = await createCalendarEvent.handler(
        {
          title: 'To Delete',
          start_time: '2024-01-15T09:00:00Z',
          end_time: '2024-01-15T10:00:00Z',
        },
        testContext
      );

      const deleteResult = await deleteCalendarEvent.handler(
        {
          event_id: createResult.event_id,
        },
        testContext
      );

      expect(deleteResult.success).toBe(true);

      const icsPath = path.join(testDir, 'team.ics');
      const icsContent = await fs.readFile(icsPath, 'utf-8');
      expect(icsContent).not.toContain('To Delete');
    });

    it('should reject delete for non-existent event', async () => {
      const result = await deleteCalendarEvent.handler(
        {
          event_id: 'non-existent-id',
        },
        testContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('getCalendarSubscriptionUrl', () => {
    it('should return calendar URL', async () => {
      const result = await getCalendarSubscriptionUrl.handler({}, testContext);

      expect(result.success).toBe(true);
      expect(result.calendar_url).toBeDefined();
      expect(result.instructions).toContain('calendar app');
    });
  });

  describe('Multiple events', () => {
    it('should handle multiple events in calendar', async () => {
      await createCalendarEvent.handler(
        {
          title: 'Event 1',
          start_time: '2024-01-15T09:00:00Z',
          end_time: '2024-01-15T10:00:00Z',
        },
        testContext
      );

      await createCalendarEvent.handler(
        {
          title: 'Event 2',
          start_time: '2024-01-15T14:00:00Z',
          end_time: '2024-01-15T15:00:00Z',
        },
        testContext
      );

      const icsPath = path.join(testDir, 'team.ics');
      const icsContent = await fs.readFile(icsPath, 'utf-8');

      const eventCount = (icsContent.match(/BEGIN:VEVENT/g) || []).length;
      expect(eventCount).toBe(2);
      expect(icsContent).toContain('Event 1');
      expect(icsContent).toContain('Event 2');
    });
  });
});
