import admin from 'firebase-admin';

// Inicializar Firebase Admin SDK si no está cargado
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        })
    });
}

const db = admin.firestore();

export default async function handler(req, res) {
    // Mercado Pago requiere respuesta HTTP 200/201 inmediata
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método no permitido' });
    }

    try {
        const { type, action, data } = req.body;
        
        // Mercado Pago puede notificar 'payment' o 'subscription_authorized_payment'
        const topic = type || req.query.topic || req.query.type;
        const entityId = data?.id || req.query.id || req.query['data.id'];

        if ((topic === 'payment' || action === 'payment.created') && entityId) {
            
            // 1. Consultar a la API de Mercado Pago los detalles del pago
            const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${entityId}`, {
                headers: {
                    'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`
                }
            });

            if (!mpResponse.ok) {
                console.error("Error al consultar pago en MP:", await mpResponse.text());
                return res.status(200).send('OK');
            }

            const paymentData = await mpResponse.json();

            // 2. Si el pago fue aprobado, extender la suscripción en Firestore
            if (paymentData.status === 'approved') {
                const tenantId = paymentData.external_reference; // UID del negocio enviado desde el Admin
                const amount = paymentData.transaction_amount;

                if (!tenantId) {
                    console.warn("Pago aprobado sin external_reference (tenantId missing)");
                    return res.status(200).send('OK');
                }

                // Si el monto es mayor o igual a $90.000 se considera Plan Anual (+365 días), sino Mensual (+30 días)
                const isYearly = amount >= 90000;
                const expirationDate = new Date();
                
                if (isYearly) {
                    expirationDate.setDate(expirationDate.getDate() + 365);
                } else {
                    expirationDate.setDate(expirationDate.getDate() + 30);
                }

                // 3. Actualizar Firestore
                await db.collection('tenants').doc(tenantId).set({
                    plan: isYearly ? 'anual' : 'mensual',
                    planStatus: 'active',
                    planExpiresAt: expirationDate.toISOString(),
                    isLifetime: false
                }, { merge: true });

                console.log(`✅ Suscripción activada para el negocio: ${tenantId} hasta ${expirationDate.toISOString()}`);
            }
        }

        // Siempre responder 200 a Mercado Pago para evitar reintentos duplicados
        return res.status(200).send('OK');

    } catch (error) {
        console.error("❌ Error en Webhook:", error);
        return res.status(200).send('OK');
    }
}
