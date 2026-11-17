import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MausAvatar } from "@/components/Avatar";
import type { SignInVerify } from "@/components/account-gate/bridge";
import { problemLine } from "@/components/cloud-buy/SignInScreen";
import { t } from "@/lib/i18n";
import type { CloudSignInStart } from "../../../electron/cloud-account.mjs";
import type { OAuthProvider } from "../../../shared/account-api";
import { usePlatform, type MobilePlatform } from "../platform";
import { createMobileAccount, isAccountAuthUrl, type AppleProblem, type AccountPlaces, type AuthResult, type CloudPairResult, type MobileAccount, type MobileCloud, type MobileTeamCloud, type PhoneCodeResult } from "./account-client";
import { setTurnSource } from "../transport/direct-rtc";
import { chosenAccountOrigin } from "./environment";

type AccountContextValue = { account: MobileAccount | null; origin: string;
  /** this app keeps a dusk account (the native app, or the preview's ?account=1) */
  offered: boolean; signOut(): Promise<void>;
  /** deletes the account from the app; false when it could not be done (nothing changed) */
  deleteAccount(): Promise<boolean>; enrollGrant(): Promise<{ enrollToken: string; dashboardUrl: string } | null>;
  clouds(): Promise<MobileCloud[] | null>; pairCloud(cloud: MobileCloud): Promise<CloudPairResult>; wakeCloud(): Promise<boolean>;
  places(): Promise<AccountPlaces | null>; pairTeamCloud(cloud: MobileTeamCloud): Promise<CloudPairResult>;
  /** what the sign-in screen asks of the account service */
  signIn: {
    providers(): Promise<OAuthProvider[]>; emailStart(email: string): Promise<CloudSignInStart>; emailVerify(code: string): Promise<SignInVerify>;
    cancelEmail(): void; browser(provider: OAuthProvider): Promise<void>;
    /** a code from a signed-in desktop's settings › phone: logs this phone in to that account, no email step */
    phoneCode(code: string): Promise<PhoneCodeResult>;
    /** a sign-in that came back through duskbot://auth and did not finish */
    problem?: string; signedIn(): void;
  } };
const AccountContext = createContext<AccountContextValue | null>(null);
export const useMobileAccount = () => useContext(AccountContext);

export function mobileAccountOrigin(native: boolean, params: URLSearchParams): string {
  const configured = import.meta.env.VITE_DUSK_ACCOUNT_ORIGIN;
  if (configured) return configured;
  const value = !native && params.get("accountOrigin");
  if (value) {
    try {
      const url = new URL(value);
      if (url.origin === value && !url.username && !url.password && (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) return value;
    } catch {}
  }
  return chosenAccountOrigin();
}

/** The sign-in buttons a phone shows, of those the account service says work. App Store guideline 4.8: an iPhone app
 * that offers another company's sign-in offers Sign in with Apple too, so without Apple the iPhone app offers none of
 * them (the email code stays). Apple leads where it is offered. */
export function providersFor(kind: MobilePlatform["kind"], enabled: readonly OAuthProvider[]): OAuthProvider[] {
  if (kind !== "ios") return [...enabled];
  return enabled.includes("apple") ? ["apple", ...enabled.filter((provider) => provider !== "apple")] : [];
}

export function appleProblemLine(problem: AppleProblem): string {
  switch (problem) {
    case "unavailable": return t("mobile.apple.unavailable");
    case "signup-closed": return t("mobile.apple.signupClosed");
    case "taken": return t("mobile.apple.taken");
    case "rate-limited": return t("mobile.apple.rateLimited");
    case "offline": return t("mobile.apple.offline");
    case "failed": return t("mobile.apple.failed");
  }
}

function authProblem(result: AuthResult): string | undefined {
  if (!result || result.outcome === "signed-in") return;
  switch (result.outcome) {
    case "oauth_denied": return t("accountGate.oauthDenied");
    case "oauth_failed": return t("accountGate.oauthFailed");
    case "oauth_expired": case "invalid-state": return t("accountGate.oauthExpired");
    case "provider_unavailable": return t("accountGate.providerUnavailable");
    case "signup_closed": return t("cloudBuy.signIn.signupClosed");
    case "identity_taken": return t("accountGate.identityTaken");
    default: return problemLine(result.outcome, result.outcome === "wrong-code" ? result.triesLeft : null);
  }
}

export function AccountGate({ children }: { children: ReactNode }) {
  const platform = usePlatform();
  const params = new URLSearchParams(location.search);
  const wanted = platform.native ? import.meta.env.VITE_DUSK_ALLOW_SIGNED_OUT !== "1" : params.get("account") === "1";
  const origin = mobileAccountOrigin(platform.native, params);
  const client = useMemo(() => createMobileAccount({ platform, origin }), [platform, origin]);
  const [account, setAccount] = useState<MobileAccount | null>(null);
  // the phone's direct link to its server asks this account for TURN; signed out it uses STUN only
  useEffect(() => { setTurnSource(() => client.screenIce()); return () => setTurnSource(null); }, [client]);
  const [restoring, setRestoring] = useState(wanted);
  const [problem, setProblem] = useState<string>();
  const pendingAuth = useRef<Promise<AuthResult> | null>(null);
  useEffect(() => {
    let active = true;
    let revision = 0;
    const stamp = revision;
    const follow = (task: Promise<AuthResult>) => {
      void task.then(result => {
        if (active) { setAccount(client.account()); setProblem(authProblem(result)); setRestoring(false); }
      }).catch(() => { if (active) { setProblem(t("cloudBuy.signIn.failed")); setRestoring(false); } }).finally(() => {
        if (active && pendingAuth.current === task) pendingAuth.current = null;
      });
    };
    if (pendingAuth.current) { ++revision; follow(pendingAuth.current); }
    const stop = platform.onAppUrl?.(url => {
      if (!isAccountAuthUrl(url)) return false;
      // the browser sheet the sign-in ran in would otherwise stay up over the app on the page it ended at
      platform.closeBrowser?.();
      ++revision;
      const task = client.handleAuthUrl(url);
      pendingAuth.current = task;
      follow(task);
      return true;
    });
    // the Keychain's sign-in shows at once; the service's check runs behind it and only a gone session signs out
    if (wanted && !pendingAuth.current) void client.cached().then(value => {
      if (active && stamp === revision && value) { setAccount(value); setRestoring(false); }
      return client.restore();
    }).then(value => { if (active && stamp === revision) setAccount(value); }).catch(() => {}).finally(() => { if (active) setRestoring(false); });
    else if (!pendingAuth.current) setRestoring(false);
    // signed out or deleted somewhere else (the website, another device): the app finds out when it comes back
    const stopResume = wanted ? platform.onResume?.(() => {
      if (pendingAuth.current || !client.account()) return;
      const resumed = revision;
      void client.restore().then(value => { if (active && resumed === revision) setAccount(value); }).catch(() => {});
    }) : undefined;
    return () => { active = false; stop?.(); stopResume?.(); };
  }, [client, platform, wanted]);
  const context = useMemo<AccountContextValue>(() => ({ account, origin, offered: wanted,
    signOut: async () => { setAccount(null); setProblem(undefined); await client.signOut(); },
    deleteAccount: async () => {
      const outcome = await client.deleteAccount();
      if (outcome === "failed") return false;
      setAccount(null); setProblem(undefined);
      return true;
    },
    enrollGrant: () => client.enrollGrant(),
    clouds: () => client.clouds(), pairCloud: cloud => client.pairCloud(cloud), wakeCloud: () => client.wakeCloud(),
    places: () => client.places(), pairTeamCloud: cloud => client.pairTeamCloud(cloud),
    signIn: {
      providers: async () => providersFor(platform.kind, await client.providers()),
      emailStart: email => client.emailStart(email), emailVerify: code => client.emailVerify(code), cancelEmail: () => client.cancelEmail(),
      phoneCode: async code => {
        const result = await client.phoneCode(code);
        if (result.outcome === "signed-in") { setAccount(client.account()); setProblem(undefined); }
        return result;
      },
      browser: async provider => {
        setProblem(undefined);
        // on the iPhone, Apple signs in in the system's own sheet, not a web page
        if (provider !== "apple" || !platform.appleSignIn) return client.oauthStart(provider);
        const result = await client.appleNative();
        if (result.outcome === "signed-in") setAccount(client.account());
        else if (result.outcome !== "canceled") setProblem(appleProblemLine(result.outcome));
      },
      problem, signedIn: () => { setAccount(client.account()); setProblem(undefined); },
    },
  }), [account, origin, wanted, client, platform.kind, platform.appleSignIn, problem]);
  if (wanted && restoring) return <div className="dusk-mobile flex size-full items-center justify-center bg-app"><MausAvatar color="green" size={56} state="idle" animated={false} personality={false} /></div>;
  return <AccountContext value={context}>{children}</AccountContext>;
}
