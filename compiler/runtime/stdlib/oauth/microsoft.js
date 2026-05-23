// scrml:oauth/microsoft — runtime shim
//
// Hand-written ES module mirroring stdlib/oauth/microsoft.scrml. Microsoft
// Identity Platform (Entra ID) preset.
//
// Surface (must match stdlib/oauth/microsoft.scrml exports):
//   - microsoftConfig(opts)            → config object

export function microsoftConfig(opts) {
  if (!opts) throw new Error("[scrml:oauth/microsoft] opts required");
  const tenant = opts.tenant || "common";

  const extra = {};
  if (opts.prompt) extra.prompt = opts.prompt;
  if (opts.loginHint) extra.login_hint = opts.loginHint;
  if (opts.domainHint) extra.domain_hint = opts.domainHint;

  const base = `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0`;

  return {
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    redirectUri: opts.redirectUri,
    authorizeUrl: `${base}/authorize`,
    tokenUrl: `${base}/token`,
    userInfoUrl: "https://graph.microsoft.com/oidc/userinfo",
    revocationUrl: null,
    scopes: opts.scopes || ["openid", "profile", "email", "offline_access"],
    usePKCE: true,
    extraAuthParams: extra,
    storage: opts.storage,
    tenant,
  };
}
