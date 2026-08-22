import { handlePreflightRequest } from "./preflight.ts";

type FeatureFlagsHandler = (req: Request) => Promise<Response>;
type FeatureFlagsModule = { handler: FeatureFlagsHandler };
type FeatureFlagsLoader = () => Promise<FeatureFlagsModule>;

const loadFeatureFlags: FeatureFlagsLoader = () => import("./runtime.ts");

export const createHandler = (
  loadApplication: FeatureFlagsLoader = loadFeatureFlags,
): FeatureFlagsHandler => {
  return async (req: Request): Promise<Response> => {
    const preflightResponse = handlePreflightRequest(req);
    if (preflightResponse) {
      return preflightResponse;
    }

    const { handler } = await loadApplication();
    return handler(req);
  };
};

export const handler = createHandler();

if (import.meta.main) {
  Deno.serve(handler);
}

export default handler;
