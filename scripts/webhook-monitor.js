// Monitor pentru webhook-uri Stripe în timpul dezvoltării
// Rulează cu: node scripts/webhook-monitor.js

const express = require('express');
const crypto = require('crypto');

const app = express();
const PORT = process.env.WEBHOOK_MONITOR_PORT || 3001;

// Middleware pentru raw body (necesar pentru Stripe signature verification)
app.use('/webhook-monitor', express.raw({ type: 'application/json' }));

// Storage pentru evenimentele primite
let webhookEvents = [];
let requestCount = 0;

// Funcție pentru formatarea datei
function formatTimestamp(timestamp) {
  return new Date(timestamp).toLocaleString('ro-RO', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

// Funcție pentru verificarea signature-ului Stripe
function verifyStripeSignature(payload, signature, secret) {
  if (!signature || !secret) return false;
  
  const elements = signature.split(',');
  const timestamp = elements.find(el => el.startsWith('t=')).split('=')[1];
  const expectedSignature = elements.find(el => el.startsWith('v1=')).split('=')[1];
  
  const signedPayload = timestamp + '.' + payload;
  const computedSignature = crypto
    .createHmac('sha256', secret)
    .update(signedPayload, 'utf8')
    .digest('hex');
  
  return computedSignature === expectedSignature;
}

// Endpoint pentru primirea webhook-urilor
app.post('/webhook-monitor', (req, res) => {
  requestCount++;
  const timestamp = Date.now();
  const stripeSignature = req.headers['stripe-signature'];
  const payload = req.body.toString();
  
  let eventData;
  let isValidSignature = false;
  
  try {
    eventData = JSON.parse(payload);
    
    // Verifică signature-ul dacă avem secret
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (webhookSecret && stripeSignature) {
      isValidSignature = verifyStripeSignature(payload, stripeSignature, webhookSecret);
    }
    
  } catch (error) {
    console.error('❌ Error parsing webhook payload:', error.message);
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }
  
  // Stochează evenimentul
  const webhookEvent = {
    id: requestCount,
    timestamp,
    eventType: eventData.type,
    eventId: eventData.id,
    livemode: eventData.livemode,
    isValidSignature,
    paymentIntentId: eventData.data?.object?.id || null,
    amount: eventData.data?.object?.amount || null,
    currency: eventData.data?.object?.currency || null,
    status: eventData.data?.object?.status || null,
    metadata: eventData.data?.object?.metadata || {},
    rawPayload: payload,
    headers: req.headers
  };
  
  webhookEvents.unshift(webhookEvent); // Adaugă la început pentru ultimele evenimente
  
  // Păstrează doar ultimele 50 de evenimente
  if (webhookEvents.length > 50) {
    webhookEvents = webhookEvents.slice(0, 50);
  }
  
  // Log în consolă
  console.log(`\n🔔 [${formatTimestamp(timestamp)}] Webhook #${requestCount}`);
  console.log(`📝 Event Type: ${eventData.type}`);
  console.log(`🆔 Event ID: ${eventData.id}`);
  console.log(`🔐 Valid Signature: ${isValidSignature ? '✅' : '❌'}`);
  
  if (eventData.type === 'payment_intent.succeeded') {
    console.log(`💳 Payment Intent: ${webhookEvent.paymentIntentId}`);
    console.log(`💰 Amount: ${webhookEvent.amount / 100} ${webhookEvent.currency.toUpperCase()}`);
    console.log(`📧 Customer Email: ${webhookEvent.metadata.customerEmail || 'N/A'}`);
    console.log(`🚗 License Plate: ${webhookEvent.metadata.licensePlate || 'N/A'}`);
  }
  
  // Returnează status 200 pentru toate webhook-urile
  res.status(200).json({ 
    received: true, 
    eventId: eventData.id,
    monitorId: requestCount
  });
});

// Dashboard HTML pentru monitorizare
app.get('/', (req, res) => {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Stripe Webhook Monitor</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
            .container { max-width: 1200px; margin: 0 auto; }
            .header { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            .stats { display: flex; gap: 20px; margin-bottom: 20px; }
            .stat-card { background: white; padding: 15px; border-radius: 8px; flex: 1; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            .event { background: white; margin-bottom: 10px; padding: 20px; border-radius: 8px; border-left: 4px solid #4CAF50; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            .event.failed { border-left-color: #f44336; }
            .event-header { display: flex; justify-content: between; align-items: center; margin-bottom: 10px; }
            .event-type { font-weight: bold; color: #333; }
            .event-time { color: #666; font-size: 0.9em; }
            .event-details { background: #f9f9f9; padding: 10px; border-radius: 4px; font-family: monospace; font-size: 0.9em; }
            .badge { padding: 2px 8px; border-radius: 12px; font-size: 0.8em; color: white; }
            .badge.success { background: #4CAF50; }
            .badge.error { background: #f44336; }
            .badge.test { background: #2196F3; }
            .badge.live { background: #FF9800; }
            .no-events { text-align: center; color: #666; font-style: italic; padding: 40px; }
            .refresh-btn { background: #4CAF50; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; }
            .refresh-btn:hover { background: #45a049; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🔔 Stripe Webhook Monitor</h1>
                <p>Monitorizare în timp real a webhook-urilor Stripe</p>
                <button class="refresh-btn" onclick="window.location.reload()">🔄 Refresh</button>
            </div>
            
            <div class="stats">
                <div class="stat-card">
                    <h3>${requestCount}</h3>
                    <p>Total Requests</p>
                </div>
                <div class="stat-card">
                    <h3>${webhookEvents.filter(e => e.eventType === 'payment_intent.succeeded').length}</h3>
                    <p>Successful Payments</p>
                </div>
                <div class="stat-card">
                    <h3>${webhookEvents.filter(e => e.isValidSignature).length}</h3>
                    <p>Valid Signatures</p>
                </div>
            </div>
            
            <div class="events">
                ${webhookEvents.length === 0 ? 
                  '<div class="no-events">Niciun webhook primit încă. Fă o plată test pentru a vedea evenimente aici.</div>' :
                  webhookEvents.map(event => `
                    <div class="event ${event.isValidSignature ? '' : 'failed'}">
                        <div class="event-header">
                            <span class="event-type">${event.eventType}</span>
                            <div>
                                <span class="badge ${event.isValidSignature ? 'success' : 'error'}">
                                    ${event.isValidSignature ? '✅ Valid' : '❌ Invalid Signature'}
                                </span>
                                <span class="badge ${event.livemode ? 'live' : 'test'}">
                                    ${event.livemode ? '🔴 LIVE' : '🧪 TEST'}
                                </span>
                            </div>
                        </div>
                        <div class="event-time">${formatTimestamp(event.timestamp)} • ID: ${event.eventId}</div>
                        ${event.paymentIntentId ? `
                        <div class="event-details">
                            <strong>Payment Intent:</strong> ${event.paymentIntentId}<br>
                            <strong>Amount:</strong> ${event.amount ? (event.amount / 100) + ' ' + (event.currency || '').toUpperCase() : 'N/A'}<br>
                            <strong>Customer:</strong> ${event.metadata.customerEmail || 'N/A'}<br>
                            <strong>License Plate:</strong> ${event.metadata.licensePlate || 'N/A'}<br>
                            <strong>Booking Period:</strong> ${event.metadata.startDate || 'N/A'} → ${event.metadata.endDate || 'N/A'}
                        </div>
                        ` : ''}
                    </div>
                  `).join('')
                }
            </div>
        </div>
        
        <script>
            // Auto-refresh la fiecare 30 de secunde
            setTimeout(() => window.location.reload(), 30000);
        </script>
    </body>
    </html>
  `;
  
  res.send(html);
});

// Endpoint pentru evenimente JSON
app.get('/api/events', (req, res) => {
  res.json({
    totalEvents: requestCount,
    events: webhookEvents
  });
});

// Pornește serverul
app.listen(PORT, () => {
  console.log(`\n🚀 Stripe Webhook Monitor started!`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`🔗 Webhook URL: http://localhost:${PORT}/webhook-monitor`);
  console.log(`📱 API: http://localhost:${PORT}/api/events`);
  console.log('\n⚙️  Pentru a folosi acest monitor:');
  console.log('1. Setează webhook URL în Stripe Dashboard la:');
  console.log(`   http://localhost:${PORT}/webhook-monitor`);
  console.log('2. Sau folosește ngrok pentru a expune portul:');
  console.log(`   ngrok http ${PORT}`);
  console.log('\n🔍 Monitoring webhook events...\n');
});

module.exports = app; 