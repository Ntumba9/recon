"use strict";

/**
 * In-memory store for the mock provider. Deliberately independent of
 * RECON's own Postgres/Prisma store - this is a stand-in for a third
 * party's system of record, reachable only through server.js's HTTP API.
 */

let payments = new Map();
let webhookLog = [];
let sentWebhooks = new Map();
let nextSeq = 1;
let truncationExtraCount = 0;

function reset() {
  payments = new Map();
  webhookLog = [];
  sentWebhooks = new Map();
  nextSeq = 1;
  truncationExtraCount = 0;
}

/**
 * Simulates a partial export: when active, every /payments page declares a
 * `total` that is higher than the number of records the listing will ever
 * actually return, the way a provider's settlement export can silently
 * drop rows. `extraCount` (default 1) is how many "missing" records to
 * claim.
 */
function setSimulateTruncation(active, extraCount) {
  truncationExtraCount = active ? Math.max(1, extraCount || 1) : 0;
}

function isSimulatingTruncation() {
  return truncationExtraCount > 0;
}

function nextPaymentId() {
  const id = `pay_${String(nextSeq).padStart(6, "0")}`;
  nextSeq += 1;
  return id;
}

/**
 * @param {{orderReference: string, amountMinor: number, currency: string, status: string, createdAt?: string}} data
 */
function createPayment(data) {
  const now = data.createdAt ? new Date(data.createdAt) : new Date();
  const payment = {
    id: nextPaymentId(),
    orderReference: data.orderReference,
    amountMinor: data.amountMinor,
    currency: data.currency,
    status: data.status,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  payments.set(payment.id, payment);
  return payment;
}

function getPayment(id) {
  return payments.get(id) || null;
}

function updatePaymentStatus(id, status) {
  const p = payments.get(id);
  if (!p) return null;
  p.status = status;
  p.updatedAt = new Date().toISOString();
  return p;
}

/**
 * Lists payments with pagination and an optional [from, to) creation-time
 * window, both in UTC. Mirrors the kind of partial, paginated export a real
 * provider would give you - callers must not assume a single page is the
 * whole picture.
 */
function listPayments({ from, to, cursor, limit } = {}) {
  const pageLimit = Math.min(Math.max(limit || 20, 1), 100);
  let all = Array.from(payments.values()).sort((a, b) =>
    a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt)
  );

  if (from) all = all.filter((p) => p.createdAt >= from);
  if (to) all = all.filter((p) => p.createdAt < to);

  let startIndex = 0;
  if (cursor) {
    const idx = all.findIndex((p) => p.id === cursor);
    startIndex = idx === -1 ? 0 : idx + 1;
  }

  const page = all.slice(startIndex, startIndex + pageLimit);
  const hasMore = startIndex + pageLimit < all.length;
  const nextCursor = hasMore ? page[page.length - 1].id : null;

  return { data: page, nextCursor, hasMore, total: all.length + truncationExtraCount };
}

function logWebhookAttempt(entry) {
  webhookLog.push({ ...entry, at: new Date().toISOString() });
}

function getWebhookLog() {
  return webhookLog.slice();
}

function recordSentWebhook(eventId, body) {
  sentWebhooks.set(eventId, body);
}

function getSentWebhook(eventId) {
  return sentWebhooks.get(eventId) || null;
}

module.exports = {
  reset,
  createPayment,
  getPayment,
  updatePaymentStatus,
  listPayments,
  logWebhookAttempt,
  getWebhookLog,
  recordSentWebhook,
  getSentWebhook,
  setSimulateTruncation,
  isSimulatingTruncation,
};
