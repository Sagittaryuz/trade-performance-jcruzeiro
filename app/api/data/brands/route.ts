import { currentOrStatic } from "../_shared";

export async function GET(request: Request) {
  return currentOrStatic("brands", request);
}
