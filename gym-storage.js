// Netlify Function : petit magasin clé-valeur générique adossé à Netlify Blobs.
// GET    ?key=xxx        -> { key, value }              (404 si absente)
// POST   { key, value }  -> { key, value }
// DELETE { key }         -> { key, deleted: true }
//
// À placer dans netlify/functions/gym-storage.js
// Nécessite le package "@netlify/blobs" (npm install @netlify/blobs).
// Sur un déploiement Netlify normal, getStore() récupère automatiquement le contexte
// du site (pas besoin de configurer manuellement un token ou un site ID).

const { getStore } = require("@netlify/blobs");

const STORE_NAME = "fonte-gym-tracker";

exports.handler = async (event) => {
  let store;
  try {
    store = getStore(STORE_NAME);
  } catch (e) {
    return json(500, { error: "Impossible d'initialiser Netlify Blobs : " + e.message });
  }

  try {
    if (event.httpMethod === "GET") {
      const key = event.queryStringParameters && event.queryStringParameters.key;
      if (!key) return json(400, { error: "Paramètre 'key' requis" });
      const value = await store.get(key);
      if (value === null) return json(404, { error: "Clé introuvable" });
      return json(200, { key, value });
    }

    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      if (!body.key) return json(400, { error: "Champ 'key' requis" });
      await store.set(body.key, body.value ?? "");
      return json(200, { key: body.key, value: body.value ?? "" });
    }

    if (event.httpMethod === "DELETE") {
      const body = JSON.parse(event.body || "{}");
      if (!body.key) return json(400, { error: "Champ 'key' requis" });
      await store.delete(body.key);
      return json(200, { key: body.key, deleted: true });
    }

    return json(405, { error: "Méthode non supportée" });
  } catch (e) {
    return json(500, { error: e.message });
  }
};

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj),
  };
}
