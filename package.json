import admin from 'firebase-admin';

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        })
    });
}

const db = admin.firestore();

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    try {
        const { type, data } = req.body;

        if (type === 'payment' || req.query.type === 'payment') {
            const paymentId = data?.id || req.query['data.id'];
            
            // Consultar a la API de Mercado Pago la información del pago
            const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
                headers: {
                    'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`
                }
            });

            const paymentData = await mpRes.json();

            if (paymentData.status === 'approved') {
                const tenantId = paymentData.external_reference; // ID del negocio asignado
                const amount = paymentData.transaction_amount;

                // Calcular vigencia (+30 días para mensual, +365 días para anual)
                const isYearly = amount >= 90000;
                const expiration = new Date();
                if (isYearly) {
                    expiration.setFullYear(expiration.getFullYear() + 1);
                } else {
                    expiration.setMonth(expiration.getMonth() + 1);
                }

                await db.collection('tenants').doc(tenantId).set({
                    plan: isYearly ? 'anual' : 'mensual',
                    planStatus: 'active',
                    planExpiresAt: expiration.toISOString(),
                    isLifetime: false
                }, { merge: true });

                console.log(`Plan renovado exitosamente para tenant: ${tenantId}`);
            }
        }

        return res.status(200).send('OK');
    } catch (err) {
        console.error("Error procesando Webhook:", err);
        return res.status(500).send('Error');
    }
}
