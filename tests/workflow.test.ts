import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import db from "@/lib/db";
import { POST as createRfq } from "@/app/api/rfq/route";
import {
  GET as getRfq,
  PATCH as updateRfq,
} from "@/app/api/rfq/[id]/route";
import { POST as orchestrate } from "@/app/api/rfq/[id]/orchestrate/route";
import { POST as checkout } from "@/app/api/rfq/[id]/checkout/route";
import { PUT as confirmPayment } from "@/app/api/razorpay/webhook/route";
import { POST as revise } from "@/app/api/rfq/[id]/revision/route";

const JSON_HEADERS = { "Content-Type": "application/json" };

beforeEach(() => {
  db.exec(`
    DELETE FROM webhook_events;
    DELETE FROM revisions;
    DELETE FROM commitments;
    DELETE FROM capability_receipts;
    DELETE FROM quotes;
    DELETE FROM audit_events;
    DELETE FROM rfqs;
  `);
});

describe("SpecLock workflow", () => {
  it("runs RFQ → quote → idempotent checkout → locked commitment", async () => {
    const id = await createCompleteRfq();
    const context = ctx(id);

    const verification = await orchestrate(
      jsonRequest(`/api/rfq/${id}/orchestrate`, "POST", {}),
      context
    );
    expect(verification.status).toBe(200);
    expect((await verification.json()).blocked).toBe(false);

    const firstCheckout = await checkout(
      new NextRequest(url(`/api/rfq/${id}/checkout`), { method: "POST" }),
      context
    );
    expect(firstCheckout.status).toBe(200);
    const order = await firstCheckout.json();
    expect(order.mock).toBe(true);

    const secondCheckout = await checkout(
      new NextRequest(url(`/api/rfq/${id}/checkout`), { method: "POST" }),
      context
    );
    const repeated = await secondCheckout.json();
    expect(repeated.orderId).toBe(order.orderId);
    expect(repeated.reused).toBe(true);

    const confirmation = await confirmPayment(
      jsonRequest("/api/razorpay/webhook", "PUT", { orderId: order.orderId })
    );
    expect(confirmation.status).toBe(200);

    const duplicate = await confirmPayment(
      jsonRequest("/api/razorpay/webhook", "PUT", { orderId: order.orderId })
    );
    expect((await duplicate.json()).duplicate).toBe(true);

    const detail = await getRfq(
      new NextRequest(url(`/api/rfq/${id}`)),
      context
    );
    const body = await detail.json();
    expect(body.rfq.status).toBe("locked");
    expect(body.commitment.status).toBe("locked");
    expect(body.commitment.razorpayPaymentId).toMatch(/^pay_mock_/);
  });

  it("keeps the locked specification until a revision is accepted", async () => {
    const id = await createCompleteRfq();
    const context = ctx(id);
    await orchestrate(jsonRequest(`/api/rfq/${id}/orchestrate`, "POST", {}), context);
    const orderResponse = await checkout(
      new NextRequest(url(`/api/rfq/${id}/checkout`), { method: "POST" }),
      context
    );
    const order = await orderResponse.json();
    await confirmPayment(
      jsonRequest("/api/razorpay/webhook", "PUT", { orderId: order.orderId })
    );

    const revisionResponse = await revise(
      jsonRequest(`/api/rfq/${id}/revision`, "POST", {
        changes: { quantity: 9_000 },
        reason: "Reduce first production run",
      }),
      context
    );
    expect(revisionResponse.status).toBe(200);

    const beforeAcceptance = await getRfq(
      new NextRequest(url(`/api/rfq/${id}`)),
      context
    );
    const pending = await beforeAcceptance.json();
    expect(pending.rfq.spec.quantity).toBe(10_000);
    expect(pending.revision.spec.quantity).toBe(9_000);
    expect(pending.rfq.status).toBe("revision_proposed");

    const acceptance = await checkout(
      new NextRequest(url(`/api/rfq/${id}/checkout`), { method: "POST" }),
      context
    );
    const accepted = await acceptance.json();
    expect(accepted.noPaymentRequired).toBe(true);

    const afterAcceptance = await getRfq(
      new NextRequest(url(`/api/rfq/${id}`)),
      context
    );
    const final = await afterAcceptance.json();
    expect(final.rfq.spec.quantity).toBe(9_000);
    expect(final.rfq.status).toBe("locked");
    expect(final.revision.status).toBe("accepted");
  });

  it("rejects edits after checkout and rejects unknown mock orders", async () => {
    const id = await createCompleteRfq();
    const context = ctx(id);
    await orchestrate(jsonRequest(`/api/rfq/${id}/orchestrate`, "POST", {}), context);
    await checkout(
      new NextRequest(url(`/api/rfq/${id}/checkout`), { method: "POST" }),
      context
    );

    const edit = await updateRfq(
      jsonRequest(`/api/rfq/${id}`, "PATCH", { spec: { quantity: 12_000 } }),
      context
    );
    expect(edit.status).toBe(409);

    const unknown = await confirmPayment(
      jsonRequest("/api/razorpay/webhook", "PUT", {
        orderId: "order_mock_not_real",
      })
    );
    expect(unknown.status).toBe(404);
  });
});

async function createCompleteRfq(): Promise<string> {
  const response = await createRfq(
    jsonRequest("/api/rfq", "POST", {
      rawText:
        "Need 10,000 waterproof pickle labels 50x30mm within 10 days to 560001, budget ₹25,000, exposed to oil and refrigeration",
    })
  );
  expect(response.status).toBe(201);
  return (await response.json()).id as string;
}

function jsonRequest(path: string, method: string, body: unknown): NextRequest {
  return new NextRequest(url(path), {
    method,
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

function url(path: string): string {
  return `http://localhost:43123${path}`;
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}
