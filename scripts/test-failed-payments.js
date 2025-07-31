// Script pentru testarea plăților eșuate cu diferite carduri de test Stripe
// Rulează cu: node scripts/test-failed-payments.js

const https = require('https');

// Configurare test
const TEST_CONFIG = {
  baseUrl: 'http://localhost:3000', // Schimbă cu URL-ul tău
  apiUrl: '/api/create-payment-intent'
};

// Carduri de test pentru diferite tipuri de eșecuri
const TEST_CARDS = {
  // 1. Eșecuri de bază
  generic_decline: {
    number: '4000000000000002',
    description: 'Generic decline - card declined by issuer',
    expected_error: 'card_declined',
    decline_code: 'generic_decline'
  },
  insufficient_funds: {
    number: '4000000000009995', 
    description: 'Insufficient funds - card declined due to insufficient funds',
    expected_error: 'card_declined',
    decline_code: 'insufficient_funds'
  },
  lost_card: {
    number: '4000000000009987',
    description: 'Lost card - card reported as lost',
    expected_error: 'card_declined', 
    decline_code: 'lost_card'
  },
  stolen_card: {
    number: '4000000000009979',
    description: 'Stolen card - card reported as stolen',
    expected_error: 'card_declined',
    decline_code: 'stolen_card'
  },
  
  // 2. Erori de date
  expired_card: {
    number: '4000000000000069',
    description: 'Expired card - card has expired',
    expected_error: 'expired_card',
    decline_code: null
  },
  incorrect_cvc: {
    number: '4000000000000127',
    description: 'Incorrect CVC - CVC verification failed',
    expected_error: 'incorrect_cvc',
    decline_code: null,
    cvc: '999' // Orice CVC pentru a forța verificarea
  },
  incorrect_number: {
    number: '4242424242424241', // Număr invalid (ultima cifră greșită)
    description: 'Incorrect card number - fails Luhn check',
    expected_error: 'incorrect_number',
    decline_code: null
  },
  
  // 3. Erori de procesare
  processing_error: {
    number: '4000000000000119',
    description: 'Processing error - temporary processing issue',
    expected_error: 'processing_error',
    decline_code: null
  },
  
  // 4. Fraud prevention
  always_blocked: {
    number: '4100000000000019',
    description: 'Always blocked by Radar - highest risk level',
    expected_error: 'card_declined',
    radar_block: true
  },
  highest_risk: {
    number: '4000000000004954',
    description: 'Highest risk level - might be blocked by Radar',
    expected_error: 'card_declined',
    radar_risk: 'highest'
  },
  cvc_check_fails: {
    number: '4000000000000101',
    description: 'CVC check fails - might be blocked by Radar settings',
    expected_error: 'card_declined',
    cvc: '999',
    radar_issue: 'cvc_check'
  },
  
  // 5. Limite și restricții
  velocity_exceeded: {
    number: '4000000000006975',
    description: 'Card velocity exceeded - too many transactions',
    expected_error: 'card_declined',
    decline_code: 'card_velocity_exceeded'
  }
};

// Funcție pentru crearea unei plăți de test
function createTestPayment(cardData, testName) {
  return new Promise((resolve, reject) => {
    const paymentData = {
      amount: 100, // 1 LEU
      bookingData: {
        licensePlate: 'TEST123',
        startDate: '2024-01-15T08:00:00',
        endDate: '2024-01-16T08:00:00'
      },
      customerInfo: {
        firstName: 'Test',
        lastName: 'Failure',
        email: 'test.failure@example.com',
        phone: '0700000000'
      },
      orderId: `TEST-FAIL-${Date.now()}`
    };

    const postData = JSON.stringify(paymentData);
    
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/create-payment-intent',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    console.log(`\n🧪 Testing: ${testName}`);
    console.log(`📝 Description: ${cardData.description}`);
    console.log(`💳 Card: ${cardData.number}`);
    console.log(`❌ Expected Error: ${cardData.expected_error}`);

    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          
          if (res.statusCode === 200 && response.clientSecret) {
            console.log(`✅ PaymentIntent created: ${response.clientSecret.split('_secret_')[0]}`);
            resolve({
              success: true,
              clientSecret: response.clientSecret,
              testName,
              cardData
            });
          } else {
            console.log(`❌ PaymentIntent creation failed:`, response);
            resolve({
              success: false,
              error: response.error || 'Unknown error',
              testName,
              cardData
            });
          }
        } catch (error) {
          console.log(`💥 JSON parse error:`, error.message);
          resolve({
            success: false,
            error: 'JSON parse error',
            testName,
            cardData
          });
        }
      });
    });

    req.on('error', (error) => {
      console.log(`💥 Request error:`, error.message);
      resolve({
        success: false,
        error: error.message,
        testName,
        cardData
      });
    });

    req.write(postData);
    req.end();
  });
}

// Funcție pentru simularea confirmării plății cu cardul de test
function simulatePaymentConfirmation(clientSecret, cardData, testName) {
  // Aceasta ar trebui să fie făcută în frontend cu Stripe.js
  // Pentru demonstrație, afișăm ce ar trebui să se întâmple
  console.log(`\n🔄 Simulating payment confirmation for ${testName}:`);
  console.log(`💳 Using card: ${cardData.number}`);
  console.log(`🔐 Client Secret: ${clientSecret}`);
  
  if (cardData.cvc) {
    console.log(`🔢 Using CVC: ${cardData.cvc} (for CVC failure tests)`);
  }
  
  console.log(`📱 In your frontend, use this code:`);
  console.log(`
stripe.confirmCardPayment('${clientSecret}', {
  payment_method: {
    card: {
      number: '${cardData.number}',
      exp_month: 12,
      exp_year: 2034,
      cvc: '${cardData.cvc || '123'}'
    }
  }
}).then(function(result) {
  if (result.error) {
    console.log('❌ Payment failed:', result.error.code);
    console.log('📝 Message:', result.error.message);
    ${cardData.decline_code ? `console.log('🚫 Decline code:', result.error.decline_code);` : ''}
  } else {
    console.log('✅ Payment succeeded - This should not happen for test!');
  }
});
  `);
}

// Funcție principală de test
async function testFailedPayments() {
  console.log('🚀 Starting failed payment tests...\n');
  console.log('📋 Available test scenarios:');
  
  Object.keys(TEST_CARDS).forEach((key, index) => {
    console.log(`${index + 1}. ${key}: ${TEST_CARDS[key].description}`);
  });
  
  console.log('\n' + '='.repeat(60));
  
  // Testează fiecare card
  for (const [testName, cardData] of Object.entries(TEST_CARDS)) {
    try {
      const result = await createTestPayment(cardData, testName);
      
      if (result.success) {
        simulatePaymentConfirmation(result.clientSecret, cardData, testName);
      }
      
      // Pauză între teste
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      console.log(`💥 Test failed for ${testName}:`, error.message);
    }
    
    console.log('\n' + '-'.repeat(40));
  }
  
  console.log('\n🎯 Test Results Summary:');
  console.log('✅ All PaymentIntents should be created successfully');
  console.log('❌ Payment confirmations should fail with specific error codes');
  console.log('📝 Check your frontend handling for each error type');
  console.log('\n📚 For live testing without payment, use these cards in your checkout form');
  console.log('🔗 Full documentation: https://docs.stripe.com/testing#declined-payments');
}

// Funcție pentru testarea unui singur tip de eșec
function testSingleFailure(cardType) {
  if (!TEST_CARDS[cardType]) {
    console.log(`❌ Unknown card type: ${cardType}`);
    console.log('Available types:', Object.keys(TEST_CARDS).join(', '));
    return;
  }
  
  console.log(`🎯 Testing single failure type: ${cardType}`);
  createTestPayment(TEST_CARDS[cardType], cardType)
    .then(result => {
      if (result.success) {
        simulatePaymentConfirmation(result.clientSecret, result.cardData, cardType);
      }
    });
}

// Rulează testele
const args = process.argv.slice(2);
if (args.length > 0) {
  testSingleFailure(args[0]);
} else {
  testFailedPayments();
}

module.exports = { TEST_CARDS, createTestPayment }; 