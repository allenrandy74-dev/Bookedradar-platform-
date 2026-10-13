import { projectInquiry, type DemoMember, type DemoRecord } from "../domain";

export { demoAccess, DEMO_NOW } from "../domain";
export { nativeAuthAdapter } from "./native-auth";

/** Fictional local members. These flags are demo metadata, never live authorization. */
export const members: DemoMember[] = [
  {
    id: "alex",
    name: "Alex Lee",
    initials: "AL",
    role: "operator",
    active: true,
  },
  {
    id: "morgan",
    name: "Morgan Chen",
    initials: "MC",
    role: "operator",
    active: true,
  },
  {
    id: "sam",
    name: "Sam Rivera",
    initials: "SR",
    role: "operator",
    active: true,
  },
];

/**
 * Derived from customer-portal/fixtures.mjs, using fictional people, example.com
 * addresses and reserved 202-555-01xx phone numbers. Only the contract DTO is
 * projected into inquiry. Proposed display fields are isolated in demoOnly context.
 * This module does not import the web portal, connect to a service or load storage.
 */
const seedRecords: readonly DemoRecord[] = [
  {
    inquiry: {
      id: "inq-1042",
      customerName: "Jamie Brooks",
      contact: {
        phone: "+1 (202) 555-0142",
        email: "jamie@example.com",
      },
      subject: "AC running, but not cooling",
      summary:
        "The upstairs system is blowing warm air. Jamie would like a callback today to discuss service options. No appointment has been promised.",
      source: "AI phone",
      receivedAt: "2026-10-12T15:12:00Z",
      updatedAt: "2026-10-12T15:12:00Z",
      status: "new",
      assigneeId: null,
      version: 1,
      notes: [],
    },
    context: {
      demoOnly: true,
      priority: "high",
      service: "AC repair",
      preferredTime: "Today, after 1 pm",
      location: "Northside · Sample service area",
      estimatedValue: 380,
      currency: "USD",
    },
  },
  {
    inquiry: {
      id: "inq-1041",
      customerName: "Taylor Reed",
      contact: {
        phone: "+1 (202) 555-0141",
        email: "taylor@example.com",
      },
      subject: "Follow-up on heat pump estimate",
      summary:
        "Taylor replied to the estimate follow-up and asked whether the proposal includes removal of the old unit. A team member needs to clarify the scope.",
      source: "Customer reply",
      receivedAt: "2026-10-12T14:45:00Z",
      updatedAt: "2026-10-12T15:04:00Z",
      status: "new",
      assigneeId: "morgan",
      version: 1,
      notes: [],
    },
    context: {
      demoOnly: true,
      priority: "normal",
      service: "Heat pump estimate",
      preferredTime: "Weekday afternoons",
      location: "Westwood · Sample service area",
      estimatedValue: 6800,
      currency: "USD",
    },
  },
  {
    inquiry: {
      id: "inq-1040",
      customerName: "Jordan Ellis",
      contact: {
        phone: "+1 (202) 555-0140",
        email: "jordan@example.com",
      },
      subject: "Annual maintenance for two systems",
      summary:
        "Jordan is comparing maintenance options for two systems and prefers a visit later this week. Availability still needs to be checked by the team.",
      source: "Web inquiry",
      receivedAt: "2026-10-12T13:50:00Z",
      updatedAt: "2026-10-12T14:10:00Z",
      status: "in_progress",
      assigneeId: "sam",
      version: 1,
      notes: [
        {
          id: "note-1",
          text: "Check whether both units use the same filter size.",
          authorId: "sam",
          createdAt: "2026-10-12T14:10:00Z",
        },
      ],
    },
    context: {
      demoOnly: true,
      priority: "normal",
      service: "System maintenance",
      preferredTime: "Thursday or Friday morning",
      location: "Oak Park · Sample service area",
      estimatedValue: 280,
      currency: "USD",
    },
  },
  {
    inquiry: {
      id: "inq-1039",
      customerName: "Casey Morgan",
      contact: {
        phone: "+1 (202) 555-0139",
        email: "casey@example.com",
      },
      subject: "Thermostat replacement question",
      summary:
        "Casey asked about replacing an older thermostat. The team requested the model number before advising on compatible options.",
      source: "Missed call",
      receivedAt: "2026-10-12T12:20:00Z",
      updatedAt: "2026-10-12T13:00:00Z",
      status: "waiting",
      assigneeId: "alex",
      version: 1,
      notes: [],
    },
    context: {
      demoOnly: true,
      priority: "normal",
      service: "Thermostat replacement",
      preferredTime: "Flexible",
      location: "Eastfield · Sample service area",
      estimatedValue: null,
      currency: "USD",
    },
  },
  {
    inquiry: {
      id: "inq-1038",
      customerName: "Avery Lane",
      contact: {
        phone: "+1 (202) 555-0138",
        email: "avery@example.com",
      },
      subject: "Seasonal tune-up",
      summary:
        "Avery asked about a seasonal tune-up. The team has closed this sample inquiry. Scheduling and payment evidence are not connected.",
      source: "AI phone",
      receivedAt: "2026-10-12T11:35:00Z",
      updatedAt: "2026-10-12T12:05:00Z",
      status: "closed",
      assigneeId: "sam",
      version: 1,
      notes: [],
    },
    context: {
      demoOnly: true,
      priority: "normal",
      service: "Seasonal tune-up",
      preferredTime: "No requested time available",
      location: "Lakeview · Sample service area",
      estimatedValue: 160,
      currency: "USD",
    },
  },
  {
    inquiry: {
      id: "inq-1037",
      customerName: "Riley Parker",
      contact: {
        phone: "+1 (202) 555-0137",
        email: "riley@example.com",
      },
      subject: "System diagnostic request",
      summary:
        "Riley asked about a system diagnostic. The team has closed this sample inquiry. A closed workflow status does not confirm a booking, completed service or payment.",
      source: "Web inquiry",
      receivedAt: "2026-10-12T10:10:00Z",
      updatedAt: "2026-10-12T11:45:00Z",
      status: "closed",
      assigneeId: "morgan",
      version: 1,
      notes: [],
    },
    context: {
      demoOnly: true,
      priority: "normal",
      service: "System diagnostic",
      preferredTime: "No requested time available",
      location: "Southbank · Sample service area",
      estimatedValue: 125,
      currency: "USD",
    },
  },
];

/** Fresh nested objects on every reset; no shared note or contact arrays. */
export function createDemoRecords(): DemoRecord[] {
  return seedRecords.map((record) => ({
    inquiry: projectInquiry(record.inquiry),
    context: { ...record.context },
  }));
}
