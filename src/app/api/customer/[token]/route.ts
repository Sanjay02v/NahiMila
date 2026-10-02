import { withNetwork } from "@/lib/product/repository";
import { customerView, storeFor } from "@/lib/product/network";
import { body, failure, ok, throttle } from "@/lib/product/http";
type Context = { params: Promise<{ token: string }> };
export async function GET(_: Request, c: Context) {
  try {
    const { token } = await c.params;
    return ok(await withNetwork((n) => customerView(n, token)));
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request, c: Context) {
  try {
    const { token } = await c.params;
    throttle("customer:" + token, 12);
    const b = await body(req);
    return ok(
      await withNetwork((n) => {
        customerView(n, token);
        const s = storeFor(n);
        if (b.action === "confirm") {
          const view = customerView(n, token);
          const existing = s.reservations.find(
            (r) => r.request_token === token && r.status !== "CANCELLED",
          );
          if (!view.can_confirm && !existing)
            throw new Error("INVALID_REQUEST");
          const result = s.confirmCustomerOffer(token);
          const detail = n.details[result.reservation.request_id];
          if (detail && !result.isDuplicate)
            detail.confirmation = {
              method: "link",
              at: new Date().toISOString(),
            };
        } else if (b.action === "cancel") s.cancelCustomerReservation(token);
        else throw new Error("INVALID_REQUEST");
        n.state = s.exportState();
        return customerView(n, token);
      }, true),
    );
  } catch (e) {
    return failure(e);
  }
}
