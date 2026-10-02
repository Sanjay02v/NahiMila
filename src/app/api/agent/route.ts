import { shopActor } from "@/lib/product/auth";
import { withNetwork } from "@/lib/product/repository";
import { merchantView } from "@/lib/product/network";
import { body, failure, ok, text, throttle } from "@/lib/product/http";
import {
  assistantFacts,
  assistantRows,
  converse,
  historySchema,
  readTools,
  recordAnswer,
  type AssistantReply,
  type AssistantResult,
  type ReadTool,
} from "@/lib/product/assistant";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    const shop = await shopActor();
    throttle("agent:" + shop.id, 20);
    const b = await body(req);
    if (b.shop_id !== undefined || b.merchant_id !== undefined)
      throw new Error("FORBIDDEN");
    if (b.tool !== undefined && !readTools.includes(b.tool as ReadTool))
      throw new Error("FORBIDDEN");
    const history = historySchema.parse(b.history ?? []);
    const v = await withNetwork((n) => merchantView(n, shop.id));
    const reply: AssistantReply =
      b.tool !== undefined
        ? {
            tool: b.tool as ReadTool,
            answer: recordAnswer(b.tool as ReadTool, shop.locale),
            draft_text: null,
            can_wait: null,
          }
        : await converse(
            text(b.question, 1200),
            history,
            assistantFacts(v),
            shop.locale,
          );
    if (reply.tool === "draft" && !reply.draft_text?.trim())
      throw new Error("AI_UNAVAILABLE");
    const result: AssistantResult = {
      answer: reply.answer,
      tool: reply.tool,
      rows: assistantRows(v, reply.tool),
      draft:
        reply.tool === "draft"
          ? { raw: reply.draft_text!.trim(), can_wait: reply.can_wait }
          : null,
      screen:
        reply.tool === "nearby" || reply.tool === "stock"
          ? "nearby"
          : reply.tool === "requests"
            ? "requests"
            : ["quotes", "orders", "pickups"].includes(reply.tool)
              ? "orders"
              : null,
      source: b.tool !== undefined ? "records" : "gemini",
    };
    await withNetwork((n) => {
      n.state.auditEvents.push({
        id: crypto.randomUUID(),
        entity_type: "AGENT",
        entity_id: shop.id,
        action: reply.tool === "draft" ? "DRAFT_REVIEW_REQUIRED" : "READ_TOOL",
        payload: { tool: reply.tool, actor: shop.user_id },
        timestamp: new Date().toISOString(),
      });
      n.state.auditEvents = n.state.auditEvents.slice(-500);
    }, true);
    return ok(result);
  } catch (e) {
    return failure(e);
  }
}
