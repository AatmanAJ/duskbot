import { hintSeen, type OnboardingStatus } from "@/lib/onboarding";

/** Kept by an install whose cloud was made or opened from this computer's first run, or by the one late hand-off: the
 * hand-off never runs again. */
export const CLOUD_OPENED_HERE = "cloud-opened-here-v1";

/** The first run's record, kept as the one that made its cloud from here when it went the dusk cloud way. */
export function cloudOpenedHere<Patch extends { onboarding: { hintsSeen?: string[] } }>(patch: Patch, cloud: boolean, had: readonly string[] = []): Patch {
  if (!cloud) return patch;
  const hints = patch.onboarding.hintsSeen ?? [...had];
  return hints.includes(CLOUD_OPENED_HERE) ? patch : { ...patch, onboarding: { ...patch.onboarding, hintsSeen: [...hints, CLOUD_OPENED_HERE] } };
}

interface OwnCloudAccount {
  status?: string;
  purchase?: unknown;
  renewal?: unknown;
  machine?: { status: string };
  clouds?: Array<{ primary: boolean; runsOn: string; role?: string; status: string }>;
}

/** The account pays for a cloud of its own that is being made or is ready: never a team's Cloud someone else pays for. */
export function ownCloudPlan(account: OwnCloudAccount | null | undefined): boolean {
  if (account?.status !== "connected") return false;
  if (account.clouds) {
    return account.clouds.some((cloud) => cloud.primary && cloud.runsOn === "cloud" && cloud.role === "owner"
      && (cloud.status === "setting_up" || cloud.status === "ready"));
  }
  if (account.purchase) return true;
  return Boolean(account.renewal) && (account.machine?.status === "provisioning" || account.machine?.status === "ready");
}

/** A plan that arrived after this computer's first run ended (a late payment, one bought on the website later), with no
 * cloud made or opened from here yet: the person is taken into the cloud being made, once. */
export function lateCloudDue(facts: {
  local: boolean;
  canSave: boolean;
  config: { onboarding?: OnboardingStatus; team?: unknown; cloudHome?: boolean } | null | undefined;
  account: OwnCloudAccount | null | undefined;
  welcomeShown: boolean;
}): boolean {
  const { config } = facts;
  if (!facts.local || !facts.canSave || facts.welcomeShown || !config || config.team || config.cloudHome) return false;
  if (!config.onboarding?.completedAt || hintSeen(config.onboarding, CLOUD_OPENED_HERE)) return false;
  return ownCloudPlan(facts.account);
}
