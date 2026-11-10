"use strict";

/**
 * RECON mock payment provider.
 *
 * A mock HTTP contract modeled loosely on a typical hosted-payments API -
 * NOT a real integration with any provider. It keeps its own in-memory
 * store (store.js), completely independent of RECON's own database, and
 * is reached by the app only through this HTTP API.
 */

const express = require("express");
const crypto = require("crypto");
const store = require("./store");
const { sign } = require("./signature");
const { loadDemoScenarios } = require("./scenarios");

const PORT = Number(process.env.PORT || 4000);
const WEBHOOK_SECRET = process.env.MOCK_PROVIDER_WEBHOOK_SECRET || "whsec_local_dev_only_not_a_real_secret";
const APP_WEBHOOK_URL = process.env.APP_WEBHOOK_URL || "http://localhost:3000/api/webhooks/provider";

const app = express();
app.use(express.json());

function isoHoursAgo(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/payments/:id", (req, res) => {
  const payment = store.getPayment(req.params.id);
  if (!payment) return res.status(404).json({ error: "not_found" });
  res.json(payment);
});

app.get("/payments", (req, res) => {
  const { from, to, cursor } = req.query;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const result = store.listPayments({ from, to, cursor, limit });
  res.json(result);
});

async function deliverWebhook({ eventId, type, payment, statusOverride }) {
  const body = {
    eventId,
    type,
    paymentId: payment.id,
    orderReference: payment.orderReference,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    status: statusOverride || payment.status,
    createdAt: payment.createdAt,
  };
  const rawBody = JSON.stringify(body);
  const signature = sign(rawBody, WEBHOOK_SECRET);
  store.recordSentWebhook(eventId, { rawBody, signature });

  try {
    const res = await fetch(APP_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Mock-Signature": signature },
      body: rawBody,
    });
    store.logWebhookAttempt({ eventId, status: res.status, delivered: true });
  } catch (err) {
    store.logWebhookAttempt({ eventId, delivered: false, error: String(err) });
  }
}

/** Resend a previously-sent webhook verbatim, to exercise replay protection. */
app.post("/dev/webhooks/:eventId/resend", async (req, res) => {
  const sent = store.getSentWebhook(req.params.eventId);
  if (!sent) return res.status(404).json({ error: "unknown_event_id" });
  try {
    const result = await fetch(APP_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Mock-Signature": sent.signature },
      body: sent.rawBody,
    });
    res.json({ delivered: true, status: result.status });
  } catch (err) {
    res.status(502).json({ delivered: false, error: String(err) });
  }
});

app.get("/dev/webhook-log", (_req, res) => res.json(store.getWebhookLog()));

app.post("/dev/reset", (_req, res) => {
  store.reset();
  res.json({ ok: true });
});

/**
 * Seeds the provider's own store from the shared demo scenarios and, for
 * scenarios marked deliverWebhooks, pushes a webhook to the app - except
 * where a scenario is deliberately simulating a lost webhook.
 */
app.post("/dev/seed", async (req, res) => {
  store.reset();
  const { scenarios, currency } = loadDemoScenarios();
  const created = [];

  for (const scenario of scenarios) {
    const order = scenario.order;
    const createdAt = order.createdAtOffsetHours !== undefined ? isoHoursAgo(order.createdAtOffsetHours) : undefined;

    const scenarioPayments = [];
    for (const paymentSpec of scenario.payments || []) {
      const payment = store.createPayment({
        orderReference: order.reference,
        amountMinor: paymentSpec.amountMinor,
        currency: currency,
        status: paymentSpec.status,
        createdAt,
      });
      scenarioPayments.push(payment);
    }

    if (scenario.deliverWebhooks && scenarioPayments.length > 0) {
      const last = scenarioPayments[scenarioPayments.length - 1];
      const claimedStatus = scenario.webhookOverrideStatus || last.status;
      const type =
        claimedStatus === "refunded" ? "payment.refunded" : claimedStatus === "failed" ? "payment.failed" : "payment.succeeded";
      const eventId = `evt_${scenario.id}_${crypto.randomBytes(4).toString("hex")}`;
      await deliverWebhook({
        eventId,
        type,
        payment: last,
        statusOverride: scenario.webhookOverrideStatus,
      });
    }

    created.push({ scenarioId: scenario.id, orderReference: order.reference, payments: scenarioPayments });
  }

  res.json({ ok: true, created });
});

const server = app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[mock-provider] listening on :${PORT}`);
});

module.exports = { app, server };
