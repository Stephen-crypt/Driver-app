import type { useRouter } from "expo-router";

type Router = ReturnType<typeof useRouter>;

/**
 * Back, or home if there is nowhere to go back to. A screen opened fresh - the
 * app restored straight onto it, or a deep link - has no history, and a bare
 * router.back() there does nothing but log an error.
 */
export function goBack(router: Router): void {
  if (router.canGoBack()) router.back();
  else router.replace("/");
}
