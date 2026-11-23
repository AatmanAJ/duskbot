import { z } from "zod";
import { parseAccountAvatarUrl, parseUserAvatarChoice, type UserAvatarChoice } from "../shared/user-avatar.ts";

const accountAvatarUrlSchema = z.string().max(1024).refine(
  (value) => parseAccountAvatarUrl(value) !== null,
  "must be an https URL without credentials or port",
);
const avatarChoiceSchema = z.string().max(40).refine((value) => parseUserAvatarChoice(value) !== null, "invalid avatar choice")
  .transform((value) => value as UserAvatarChoice);
const accountIdSchema = z.string().trim().min(1).max(120);

export const accountFaceSchema = z.object({
  id: accountIdSchema,
  email: z.string().optional(),
  avatarUrl: accountAvatarUrlSchema.optional(),
  avatar: avatarChoiceSchema.optional(),
});

/** The face as config.json holds it, which another app version may have written: a field this one does not know is
 * dropped, a value it cannot use is left out, and a face without an account id is no face, never a broken file. */
export const storedAccountFaceSchema = z.object({
  id: accountIdSchema,
  email: z.string().optional().catch(undefined),
  avatarUrl: accountAvatarUrlSchema.optional().catch(undefined),
  avatar: avatarChoiceSchema.optional().catch(undefined),
}).nullable().optional().catch(undefined);
