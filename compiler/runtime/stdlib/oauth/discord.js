// scrml:oauth/discord — runtime shim
//
// Hand-written ES module mirroring stdlib/oauth/discord.scrml. Discord OAuth
// 2.0 preset.
//
// Surface (must match stdlib/oauth/discord.scrml exports):
//   - discordConfig(opts)              → config object

export function discordConfig(opts) {
  if (!opts) throw new Error("[scrml:oauth/discord] opts required");
  const extra = {};
  if (opts.prompt) extra.prompt = opts.prompt;

  return {
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    redirectUri: opts.redirectUri,
    authorizeUrl: "https://discord.com/oauth2/authorize",
    tokenUrl: "https://discord.com/api/oauth2/token",
    userInfoUrl: "https://discord.com/api/users/@me",
    revocationUrl: "https://discord.com/api/oauth2/token/revoke",
    scopes: opts.scopes || ["identify", "email"],
    usePKCE: true,
    extraAuthParams: extra,
    storage: opts.storage,
  };
}
