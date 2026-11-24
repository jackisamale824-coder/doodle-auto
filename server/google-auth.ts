import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export const googleCerts = "https://www.googleapis.com/oauth2/v3/certs";

export class GoogleAuth {
  constructor(
    readonly clientId: string,
    private keys: JWTVerifyGetKey = createRemoteJWKSet(
      new URL(
        process.env.PLAYER_STORE_URL ? "/google-keys" : googleCerts,
        process.env.PLAYER_STORE_URL || googleCerts,
      ),
    ),
  ) {}
  async subject(credential: string, nonce: string) {
    const { payload } = await jwtVerify(credential, this.keys, {
      algorithms: ["RS256"],
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: this.clientId,
      maxTokenAge: "10 minutes",
      requiredClaims: ["exp", "iat", "sub", "nonce"],
    });
    if (
      payload.nonce !== nonce ||
      (payload.azp !== undefined && payload.azp !== this.clientId) ||
      typeof payload.sub !== "string" ||
      !payload.sub ||
      payload.sub.length > 255
    )
      throw Error("Invalid Google identity");
    return payload.sub;
  }
}
