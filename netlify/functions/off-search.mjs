// Proxy vers Open Food Facts : évite tout souci de CORS côté navigateur, et
// permet d'envoyer un User-Agent correct (recommandé par Open Food Facts,
// mais qu'un navigateur ne peut pas définir lui-même en JS).
//
// GET ?q=nom_du_produit   -> recherche texte
// GET ?barcode=1234567890 -> fiche produit par code-barres
//
// Réponse toujours de la forme { products: [...] } (tableau vide si rien
// trouvé), pour que le client n'ait qu'une seule forme à gérer.

const USER_AGENT = "Fonte-app/1.0 (usage personnel - github.com/mathieucarlu-creator/Fonte-app)";

export const handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  const params = event.queryStringParameters || {};
  const query = params.q ? params.q.trim() : "";
  const barcode = params.barcode ? params.barcode.trim() : "";

  try {
    if (barcode) {
      const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`, {
        headers: { "User-Agent": USER_AGENT },
      });
      if (!res.ok) return json(200, { products: [] });
      const data = await res.json();
      if (data.status !== 1 || !data.product) return json(200, { products: [] });
      return json(200, { products: [data.product] });
    }

    if (query) {
      // 1) Endpoint historique (rapide, format bien connu)
      const legacyUrl = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(
        query
      )}&search_simple=1&action=process&json=1&page_size=15`;
      const legacyProducts = await tryLegacySearch(legacyUrl);
      if (legacyProducts !== null) return json(200, { products: legacyProducts });

      // 2) Repli : nouvelle API de recherche (Search-a-licious)
      const modernProducts = await tryModernSearch(query);
      if (modernProducts !== null) return json(200, { products: modernProducts });

      return json(502, { error: "Open Food Facts n'a pas répondu dans un format reconnu.", products: [] });
    }

    return json(400, { error: "Paramètre 'q' ou 'barcode' requis", products: [] });
  } catch (e) {
    return json(500, { error: e.message, products: [] });
  }
};

// Retourne un tableau de produits, ou null si la réponse n'est pas exploitable
// (ex: HTML renvoyé au lieu de JSON), pour déclencher le repli.
async function tryLegacySearch(url) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
    if (!res.ok) return null;
    const text = await res.text();
    const data = JSON.parse(text);
    return Array.isArray(data.products) ? data.products : null;
  } catch (e) {
    return null;
  }
}

async function tryModernSearch(query) {
  try {
    const res = await fetch(`https://search.openfoodfacts.org/search?q=${encodeURIComponent(query)}&page_size=15`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const hits = data.hits || data.products || [];
    return Array.isArray(hits) ? hits : null;
  } catch (e) {
    return null;
  }
}

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(obj),
  };
}
