import { useEffect, useRef, type Ref } from "react";
import { CloudConnectAi } from "@/components/CloudEngineSignIn";
import { engineReady } from "@/components/EngineLibrary";
import { t } from "@/lib/i18n";
import { useStoreSelector } from "@/state/store";
import { Footer, PRIMARY, QUIET, StepHeading } from "./parts";

/** Connecting an AI of the person's own: one that already works when the step opens (signed in here) is used as
 * it is and the step finishes itself; otherwise the same Connect an AI grid every machine shows. */
export function WelcomeEngine({ name, headingRef, onFinish }: { name: string; headingRef: Ref<HTMLHeadingElement>; onFinish: () => void }) {
  const own = useStoreSelector((s) => s.instances.some((instance) => engineReady(instance)));
  const readyOnOpen = useRef(own);
  useEffect(() => {
    if (readyOnOpen.current) onFinish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (readyOnOpen.current) return null;
  return <section aria-labelledby="cloud-welcome-step" data-welcome-step="engine" className="flex flex-col">
    <StepHeading headingRef={headingRef} title={t("cloudSetup.engine.title")} sub={t("cloudWelcome.engine.sub", { name })} />
    <CloudConnectAi className="mt-6" />
    <Footer className="mt-7">
      {own
        ? <button type="button" className={PRIMARY} onClick={onFinish}>{t("onboarding.continue")}</button>
        : <button type="button" className={QUIET} onClick={onFinish}>{t("cloudIntent.skip")}</button>}
    </Footer>
  </section>;
}
