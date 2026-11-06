import { publicOrigin } from "@/lib/config";
import { homePage } from "@/lib/html";

export function GET(req: Request) {
  return homePage(publicOrigin(req));
}
