// scrml:oauth/github — runtime shim
//
// Hand-written ES module mirroring stdlib/oauth/github.scrml. GitHub OAuth
// Apps (classic) preset.
//
// Surface (must match stdlib/oauth/github.scrml exports):
//   - githubConfig(opts)               → config object

export function githubConfig(opts) {
  if (!opts) throw new Error("[scrml:oauth/github] opts required");
  const extra = {};
  if (opts.allowSignup !== null && opts.allowSignup !== undefined) {
    extra.allow_signup = opts.allowSignup ? "true" : "false";
  }
  if (opts.login) extra.login = opts.login;

  return {
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    redirectUri: opts.redirectUri,
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    userInfoUrl: "https://api.github.com/user",
    revocationUrl: null,
    scopes: opts.scopes || ["read:user", "user:email"],
    usePKCE: true,
    extraAuthParams: extra,
    storage: opts.storage,
  };
}
