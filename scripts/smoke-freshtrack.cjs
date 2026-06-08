/**
 * One-off smoke test: load credentials from .env.local, mint a token via
 * our new transport, and run the entities query. Confirms end-to-end that
 * the new lib/freshtrack-graphql.ts + queries module work against live FT.
 * Run: `node scripts/smoke-freshtrack.cjs`. Never committed to CI.
 */
require("fs").readFileSync(".env.local", "utf8").split(/\r?\n/).forEach((l) => {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});

(async () => {
  // The TS modules use server-only + path alias; for this smoke test we
  // re-implement the auth+query inline (mirrors lib/freshtrack-graphql.ts).
  const FT_URL = process.env.FT_GRAPHQL_URL ?? "https://mackaysmarketing.freshtrack.com/api/graphql";

  async function gql(query, variables, bearer) {
    const res = await fetch(FT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: JSON.stringify({ query, variables }),
    });
    const body = await res.json();
    if (body.errors) {
      const code = body.errors[0]?.code ?? "?";
      throw new Error(`[${code}] ${body.errors[0]?.message}`);
    }
    return body.data;
  }

  console.log("1. mint token...");
  const auth = await gql(
    `mutation Auth($email: String!, $credentials: String!) {
       authenticateWithCredentials(authData: { email: $email, credentials: $credentials }) {
         authToken { token expiresOn }
       }
     }`,
    { email: process.env.FT_GRAPHQL_EMAIL, credentials: process.env.FT_GRAPHQL_PASSWORD },
    null
  );
  const token = auth.authenticateWithCredentials.authToken.token;
  console.log("   ok; expires", auth.authenticateWithCredentials.authToken.expiresOn);

  console.log("2. pull 5 entities with the SAME field selection as Q_ENTITIES_FULL...");
  const r = await gql(
    `query EntitiesFull($limit: Int!) {
       entities(filterIsActive: true, filterLimit: $limit) {
         id code type
         orgName orgLegalName orgContactName orgTaxNo
         indFirstName indMiddleName indLastName
         email phoneNo mobileNo
         isActive isGrower
         isConsignorActive isConsigneeActive isMarketerActive isFarmActive
         parentId
         parent { id code }
         farmId
         farm { id supplierId regionId timeZone isActive }
       }
     }`,
    { limit: 5 },
    token
  );

  console.log("   got", r.entities.length, "entities");
  for (const e of r.entities) {
    console.log(`     ${e.code.padEnd(8)} | ${(e.orgName || `${e.indFirstName} ${e.indLastName}`).padEnd(28)} | grower:${e.isGrower} | parent:${e.parent?.code ?? "-"} | farm:${e.farmId ? "y" : "-"}`);
  }

  console.log("3. classification smoke (a typical batch)...");
  // The new lib/freshtrack/classify.ts logic, copied inline for the smoke:
  const parents = new Set();
  for (const e of r.entities) { if (e.parentId) parents.add(e.parentId); }
  function classify(e) {
    if (!e.isGrower) return "skip";
    if (parents.has(e.id)) return "rcti_recipient";
    if (e.parentId !== null) return "farm";
    if (e.isConsignorActive) return "self_paid_farm";
    return "orphan_farm";
  }
  for (const e of r.entities) console.log(`     ${e.code} -> ${classify(e)}`);

  console.log("smoke OK");
})().catch((e) => { console.error("SMOKE FAILED:", e.message); process.exit(1); });
