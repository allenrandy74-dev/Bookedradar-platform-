import type { DemoRecord, Status } from "./model";

export interface InquiryFilters {
  readonly query?: string;
  readonly status?: Status | "all";
  readonly assigneeId?: string | "unassigned" | "all";
  readonly priority?: "high" | "normal" | "all";
}

/** Filters the bounded local sample only; never claims full customer history. */
export function filterInquiries(
  records: readonly DemoRecord[],
  filters: InquiryFilters = {},
): DemoRecord[] {
  const query = (filters.query ?? "").trim().toLocaleLowerCase();
  return records.filter(({ inquiry, context }) => {
    if (
      filters.status &&
      filters.status !== "all" &&
      inquiry.status !== filters.status
    )
      return false;
    if (filters.assigneeId && filters.assigneeId !== "all") {
      const expected =
        filters.assigneeId === "unassigned" ? null : filters.assigneeId;
      if (inquiry.assigneeId !== expected) return false;
    }
    if (
      filters.priority &&
      filters.priority !== "all" &&
      context.priority !== filters.priority
    )
      return false;
    if (!query) return true;
    return [
      inquiry.id,
      inquiry.customerName,
      inquiry.subject,
      inquiry.summary,
      inquiry.contact.email,
      inquiry.contact.phone,
      inquiry.source,
      context.service,
      context.location,
    ].some((value) => value.toLocaleLowerCase().includes(query));
  });
}

export interface InquirySummary {
  readonly total: number;
  readonly newCount: number;
  readonly inProgressCount: number;
  readonly waitingCount: number;
  readonly closedCount: number;
  readonly openCount: number;
  readonly unassignedCount: number;
  readonly sampleEstimatedPipeline: number;
  readonly estimatedInquiryCount: number;
  readonly unknownEstimateCount: number;
  readonly confirmedRevenue: null;
  readonly bookings: null;
  readonly conversionRate: null;
}

export function deriveSummary(records: readonly DemoRecord[]): InquirySummary {
  const count = (status: Status) =>
    records.filter((record) => record.inquiry.status === status).length;
  const open = records.filter((record) => record.inquiry.status !== "closed");
  const estimated = open.filter(
    (record) =>
      record.context.demoOnly === true &&
      typeof record.context.estimatedValue === "number" &&
      Number.isFinite(record.context.estimatedValue) &&
      record.context.estimatedValue >= 0,
  );
  return {
    total: records.length,
    newCount: count("new"),
    inProgressCount: count("in_progress"),
    waitingCount: count("waiting"),
    closedCount: count("closed"),
    openCount: open.length,
    unassignedCount: open.filter((record) => record.inquiry.assigneeId === null)
      .length,
    sampleEstimatedPipeline: estimated.reduce(
      (total, record) => total + (record.context.estimatedValue ?? 0),
      0,
    ),
    estimatedInquiryCount: estimated.length,
    unknownEstimateCount: open.length - estimated.length,
    confirmedRevenue: null,
    bookings: null,
    conversionRate: null,
  };
}
