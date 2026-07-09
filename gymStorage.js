// Client de stockage pour la version Netlify de l'appli.
// Reproduit la même API que window.storage (get/set/delete) utilisée dans l'artefact Claude,
// mais passe par une Netlify Function adossée à Netlify Blobs.
//
// Remarque : ici il n'y a pas de compte utilisateur, donc tout est de fait "partagé" —
// le paramètre `shared` est accepté pour garder la même signature d'appel que le code
// d'origine, mais il n'a pas d'effet côté serveur.

const ENDPOINT = "/.netlify/functions/gym-storage";

async function get(key, shared = false) {
  const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`);
  if (res.status === 404) {
    throw new Error(`Clé "${key}" introuvable`);
  }
  if (!res.ok) {
    throw new Error(`Erreur de stockage (${res.status})`);
  }
  const data = await res.json();
  return { key: data.key, value: data.value, shared };
}

async function set(key, value, shared = false) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value }),
  });
  if (!res.ok) {
    throw new Error(`Erreur de sauvegarde (${res.status})`);
  }
  const data = await res.json();
  return { key: data.key, value: data.value, shared };
}

async function del(key, shared = false) {
  const res = await fetch(ENDPOINT, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
  });
  if (!res.ok) {
    throw new Error(`Erreur de suppression (${res.status})`);
  }
  const data = await res.json();
  return { key: data.key, deleted: true, shared };
}

const gymStorage = { get, set, delete: del };

export default gymStorage;
