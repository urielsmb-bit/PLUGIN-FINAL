// api/translate.js — Backend de AI Copy Localizer
// Despliega en Vercel. Tu API key de DeepL vive aquí, nunca en el plugin.

export default async function handler(req, res) {
  // CORS — permite peticiones desde el plugin de Figma
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { texts, targetLang, licenseKey } = req.body;

  // Validaciones
  if (!texts || !Array.isArray(texts) || texts.length === 0)
    return res.status(400).json({ error: 'No hay textos para traducir' });
  if (!targetLang)
    return res.status(400).json({ error: 'Falta el idioma destino' });
  if (!licenseKey || licenseKey.trim() === '')
    return res.status(401).json({ error: 'LICENCIA_REQUERIDA' });

  // 1. Validar licencia de Gumroad
  const license = await validateGumroadLicense(licenseKey.trim());
  if (!license.ok) {
    return res.status(403).json({ error: license.message });
  }

  // 2. Llamar a DeepL con tu key (variable de entorno en Vercel)
  const DEEPL_KEY = process.env.DEEPL_API_KEY;
  if (!DEEPL_KEY) {
    return res.status(500).json({ error: 'Servidor no configurado. Agrega DEEPL_API_KEY en Vercel.' });
  }

  const isFreePlan = DEEPL_KEY.endsWith(':fx');
  const DEEPL_URL = isFreePlan
    ? 'https://api-free.deepl.com/v2/translate'
    : 'https://api.deepl.com/v2/translate';

  try {
    const deepLRes = await fetch(DEEPL_URL, {
      method: 'POST',
      headers: {
        'Authorization': `DeepL-Auth-Key ${DEEPL_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: texts,
        target_lang: targetLang,
        preserve_formatting: true,
      }),
    });

    if (!deepLRes.ok) {
      if (deepLRes.status === 403) return res.status(500).json({ error: 'Error interno de servidor (key inválida)' });
      if (deepLRes.status === 456) return res.status(429).json({ error: 'Límite mensual de traducción alcanzado. Vuelve mañana.' });
      return res.status(500).json({ error: `Error DeepL: ${deepLRes.status}` });
    }

    const data = await deepLRes.json();
    return res.status(200).json({
      translations: data.translations.map(t => t.text)
    });

  } catch (err) {
    return res.status(500).json({ error: 'Error de red al contactar DeepL' });
  }
}

// ── Validación de licencia Gumroad ─────────────────────────────────────────
async function validateGumroadLicense(licenseKey) {
  const PRODUCT_ID = process.env.GUMROAD_PRODUCT_ID;

  // Sin PRODUCT_ID = modo desarrollo, acepta todo
  if (!PRODUCT_ID) {
    console.warn('[DEV] GUMROAD_PRODUCT_ID no configurado — modo desarrollo activo');
    return { ok: true };
  }

  try {
    const res = await fetch('https://api.gumroad.com/v2/licenses/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        product_id: PRODUCT_ID,
        license_key: licenseKey,
        increment_uses_count: 'false',
      }),
    });

    const data = await res.json();

    if (!data.success) return { ok: false, message: 'Licencia inválida. Cómprala en gumroad.com' };
    if (data.purchase?.refunded) return { ok: false, message: 'Esta licencia fue reembolsada' };
    if (data.purchase?.chargebacked) return { ok: false, message: 'Esta licencia fue disputada' };

    return { ok: true, email: data.purchase?.email };

  } catch (err) {
    // Si Gumroad falla por red, no bloqueamos al usuario
    console.error('Error validando Gumroad:', err);
    return { ok: true };
  }
}
