import { getStore } from "@netlify/blobs";

// Stockage du suivi corporel (composition + posture).
// Même pattern que netlify/functions/data.mjs, mais avec un store Netlify Blobs
// à part ("fonte-body-data") : ces données personnelles ne sont JAMAIS mélangées
// avec "fonte-data", le store partagé utilisé pour le suivi muscu avec Ben.
export const handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  const key = event.queryStringParameters && event.queryStringParameters.key;
  if (!key) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "missing key" }) };
  }

  if (!process.env.BLOBS_SITE_ID || !process.env.BLOBS_TOKEN) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "BLOBS_SITE_ID ou BLOBS_TOKEN manquant dans les variables d'environnement Netlify",
      }),
    };
  }

  const store = getStore({
    name: "fonte-body-data",
    siteID: process.env.BLOBS_SITE_ID,
    token: process.env.BLOBS_TOKEN,
  });

  if (event.httpMethod === "GET") {
    const value = await store.get(key);
    return { statusCode: 200, headers, body: JSON.stringify({ value: value ?? null }) };
  }

  if (event.httpMethod === "POST") {
    let value;
    try {
      value = JSON.parse(event.body || "{}").value;
    } catch (e) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "invalid body" }) };
    }
    await store.set(key, value);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: "method not allowed" }) };
};
