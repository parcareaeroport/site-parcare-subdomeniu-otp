// Script pentru testarea webhook-ului Stripe local
// Rulează cu: node scripts/test-webhook.js

const crypto = require('crypto');
const https = require('https');

// Configurare test
const TEST_CONFIG = {
  webhookUrl: 'http://localhost:3000/api/webhook', // Schimbă cu URL-ul tău
  webhookSecret: 'whsec_test_key', // Pune cheia ta de webhook secret
  testPaymentIntentId: 'pi_test_' + Date.now(),
};

// Simulează un payload de la Stripe
const testPayload = {
  id: 'evt_test_' + Date.now(),
  object: 'event',
  api_version: '2025-05-28.basil',
  created: Math.floor(Date.now() / 1000),
  data: {
    object: {
      id: TEST_CONFIG.testPaymentIntentId,
      object: 'payment_intent',
      amount: 5000, // 50 RON în cenți
      currency: 'ron',
      status: 'succeeded',
      metadata: {
        orderId: 'PO-' + Date.now(),
        customerName: 'Test User',
        customerEmail: 'test@example.com',
        licensePlate: 'B123TEST',
        startDate: '2024-01-15T08:00:00',
        endDate: '2024-01-16T08:00:00',
      }
    }
  },
  livemode: false,
  pending_webhooks: 1,
  request: {
    id: null,
    idempotency_key: null
  },
  type: 'payment_intent.succeeded'
};

// Funcție pentru generarea signature-ului Stripe
function generateStripeSignature(payload, secret) {
  const timestamp = Math.floor(Date.now() / 1000);
  const payloadString = JSON.stringify(payload);
  const signedPayload = timestamp + '.' + payloadString;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signedPayload, 'utf8')
    .digest('hex');
  
  return `t=${timestamp},v1=${signature}`;
}

// Funcție pentru trimiterea request-ului de test
function testWebhook() {
  const payloadString = JSON.stringify(testPayload);
  const signature = generateStripeSignature(testPayload, TEST_CONFIG.webhookSecret);
  
  const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/webhook',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payloadString),
      'Stripe-Signature': signature,
    }
  };

  console.log('🧪 Testing webhook...');
  console.log('📤 Payload:', JSON.stringify(testPayload, null, 2));
  console.log('🔐 Signature:', signature);
  console.log('');

  const req = https.request(options, (res) => {
    let data = '';
    
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      console.log('📥 Response Status:', res.statusCode);
      console.log('📥 Response Headers:', res.headers);
      console.log('📥 Response Body:', data);
      
      if (res.statusCode === 200) {
        console.log('✅ Webhook test SUCCESS!');
      } else {
        console.log('❌ Webhook test FAILED!');
      }
    });
  });

  req.on('error', (error) => {
    console.error('💥 Request Error:', error.message);
  });

  req.write(payloadString);
  req.end();
}

// Instrucțiuni de folosire
console.log('🚀 Stripe Webhook Tester');
console.log('========================');
console.log('');
console.log('1. Asigură-te că serverul Next.js rulează pe localhost:3000');
console.log('2. Actualizează TEST_CONFIG cu webhook secret-ul tău');
console.log('3. Rulează: node scripts/test-webhook.js');
console.log('');

// Pornește testul dacă e apelat direct
if (require.main === module) {
  testWebhook();
}

module.exports = { testWebhook, generateStripeSignature }; 