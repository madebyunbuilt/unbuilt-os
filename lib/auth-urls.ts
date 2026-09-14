/** Only same-site paths are followed after sign-in, so a link cannot send someone to another site. */
export function safeCallbackURL(value: string | string[] | null | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//') || candidate.startsWith('/\\')) return '/';
  return candidate;
}

const SIGN_IN_ERRORS: Record<string, string> = {
  INVALID_TOKEN: 'That sign-in link has already been used or has expired. Ask for a new one.',
  EXPIRED_TOKEN: 'That sign-in link has expired. Ask for a new one.',
  failed_to_create_user: 'We could not sign you in with that link. Ask for a new one, or contact the studio.',
  new_user_signup_disabled: 'We could not sign you in with that link. Ask for a new one, or contact the studio.',
  SESSION_IDLE: 'You were signed out after 12 hours of inactivity. Sign in again to continue.',
  TWO_FACTOR_EXPIRED: 'Your sign-in took too long. Ask for a new link.',
};

export function signInErrorMessage(code: string | string[] | null | undefined): string | null {
  const key = Array.isArray(code) ? code[0] : code;
  if (!key) return null;
  return SIGN_IN_ERRORS[key] ?? 'Something went wrong signing you in. Ask for a new link.';
}
