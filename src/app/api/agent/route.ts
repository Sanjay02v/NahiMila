import {
  explicitOperation,
  operationAnswer,
} from "@/lib/product/assistant-operations";
import { shopActor } from "@/lib/product/auth";
import { withNetwork } from "@/lib/product/repository";
import { merchantView } from "@/lib/product/network";
import { body, failure, ok, text, throttle } from "@/lib/product/http";
import {
  inputLanguage,
  resolvedInputLanguage,
} from "@/lib/product/input-language";
import { preserveDraftContacts } from "@/lib/product/capture-fields";
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
    const question = b.tool === undefined ? text(b.question, 1200) : "";
    const language = inputLanguage(question, shop.locale);
    const v = await withNetwork((n) => merchantView(n, shop.id));
    const explicit =
      b.tool === undefined ? explicitOperation(v, question, history) : null;
    const reply: AssistantReply = explicit
      ? {
          answer: operationAnswer(explicit.quote, explicit.topic, language),
          tool: "quotes",
          draft_text: null,
          can_wait: null,
        }
      : b.tool !== undefined
        ? {
            tool: b.tool as ReadTool,
            answer: recordAnswer(b.tool as ReadTool, shop.locale),
            draft_text: null,
            can_wait: null,
          }
        : await converse(question, history, assistantFacts(v), language);
    if (reply.tool === "draft" && !reply.draft_text?.trim())
      throw new Error("AI_UNAVAILABLE");
    const focused =
      explicit?.quote ||
      (reply.focus && reply.tool === "quotes"
        ? v.quotes[reply.focus.quote_index]
        : undefined);
    if (reply.focus && !focused) throw new Error("AI_UNAVAILABLE");
    if (focused && reply.focus)
      reply.answer = operationAnswer(
        focused,
        reply.focus.topic,
        resolvedInputLanguage(question, shop.locale, reply.input_language),
      );
    const result: AssistantResult = {
      answer: reply.answer,
      tool: reply.tool,
      rows: assistantRows(
        focused ? { ...v, quotes: [focused] } : v,
        reply.tool,
      ),
      draft:
        reply.tool === "draft"
          ? {
              raw: preserveDraftContacts(question, reply.draft_text!.trim()),
              can_wait: reply.can_wait,
            }
          : null,
      screen:
        reply.tool === "nearby" || reply.tool === "stock"
          ? "nearby"
          : reply.tool === "requests"
            ? "requests"
            : ["quotes", "orders", "pickups"].includes(reply.tool)
              ? "orders"
              : null,
      source: b.tool !== undefined || explicit ? "records" : "gemini",
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
