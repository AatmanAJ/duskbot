import type { InstanceInfo } from "@/state/store";
import { installCommandFor, installsHere } from "@/state/engine-install";

export function needsSignIn(instance: InstanceInfo | undefined): boolean {
  return instance?.snapshot.state === "available" && instance.snapshot.authenticated === false;
}

export function offersSignIn(instance: InstanceInfo | undefined): boolean {
  return Boolean(instance && needsSignIn(instance) && instance.install
    && !instance.snapshot.authenticationUnavailableReason && !apiKeySetup(instance));
}

export function needsCli(instance: InstanceInfo | undefined): boolean {
  return instance?.snapshot.state !== "available";
}

export function isApiKeyEngine(instance: InstanceInfo | undefined): boolean {
  if (!instance || instance.access !== "api" || instance.managed) return false;
  return instance.driverKind !== "claudeAgent" || Boolean(instance.snapshot.version);
}

export function apiKeySetup(instance: InstanceInfo): boolean {
  if (!(isApiKeyEngine(instance) || instance.install?.settings === "connections") || instance.snapshot.authenticationUnavailableReason) return false;
  // A key engine with its own CLI (DeepSeek Harness) is installed first, then given the key.
  if (instance.snapshot.state !== "available") return !installsHere(instance.install) && !installCommandFor(instance.install);
  return instance.snapshot.authenticated === false;
}
