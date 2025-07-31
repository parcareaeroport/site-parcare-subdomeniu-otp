const FormData = require('form-data');

// Test cu date MINIME (doar ce e absolut necesar)
async function testMinimalLPR() {
  const API_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const endpoint = `${API_URL}/api/metrici-lpr-test`;
  const authSecret = process.env.LPR_AUTH_SECRET;
  
  console.log('🧪 Testing Metrici LPR API with MINIMAL data...');
  console.log('📡 Endpoint:', endpoint);
  
  const testScenarios = [
    {
      name: "DOAR numărul de înmatriculare",
      data: { number: 'B123ABC' }
    },
    {
      name: "Număr + direcție intrare",
      data: { number: 'B456DEF', direction: '1' }
    },
    {
      name: "Număr + direcție ieșire", 
      data: { number: 'B789GHI', direction: '2' }
    },
    {
      name: "Număr + probabilitate",
      data: { number: 'B999XYZ', probability: '0.87' }
    },
    {
      name: "Număr + cameră ID",
      data: { number: 'B111AAA', id: '1' }
    },
    {
      name: "FĂRĂ număr (doar direction)",
      data: { direction: '1', id: '1' }
    },
    {
      name: "Date GOALE (test robustețe)",
      data: {}
    }
  ];

  for (const scenario of testScenarios) {
    console.log(`\n=== TEST: ${scenario.name} ===`);
    
    const form = new FormData();
    
    // Adaugă doar datele din scenariul curent
    Object.keys(scenario.data).forEach(key => {
      form.append(key, scenario.data[key]);
      console.log(`📝 Adding: ${key} = ${scenario.data[key]}`);
    });

    try {
      const fetch = (await import('node-fetch')).default;
      
      // Prepare headers
      const headers = form.getHeaders();
      if (authSecret) {
        headers['Authorization'] = `Bearer ${authSecret}`;
      }
      
      const response = await fetch(endpoint, {
        method: 'POST',
        body: form,
        headers: headers
      });
      
      const responseText = await response.text();
      
      console.log(`📥 Status: ${response.status}`);
      console.log(`📄 Response: ${responseText}`);
      
      // Analiză răspuns
      if (responseText.includes('open_barrier')) {
        console.log('✅ Barrier command: OPEN');
      } else if (responseText.includes('fbd782b5b1f90875a9773ef20bcc16aa')) {
        console.log('✅ Access granted (no barrier command)');
      } else if (responseText.includes('bb1e8f805814a0b8e46560134687237')) {
        console.log('✅ Standard acknowledgment');
      } else {
        console.log('⚠️ Unexpected response');
      }
      
    } catch (error) {
      console.error(`❌ Test failed:`, error.message);
    }
    
    // Pauză între teste
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

// Test cu date progresiv mai puține 
async function testProgressiveReduction() {
  console.log('\n🔄 Testing progressive data reduction...\n');
  
  const API_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const endpoint = `${API_URL}/api/metrici-lpr-test`;
  
  // Începe cu date complete și elimină progresiv
  const fullData = {
    id: '1',
    number: 'B123ABC',
    country_code: 'RO',
    direction: '1',
    probability: '0.95',
    first_seen: '2024-01-15_10:30:15',
    last_seen: '2024-01-15_10:30:18',
    vehicle_class: 'Car',
    vehicle_color: 'Blue',
    vehicle_maker: 'BMW',
    transactionkey: 'test_key_123'
  };
  
  const reductionSteps = [
    { name: "Date COMPLETE", remove: [] },
    { name: "Fără timestamp-uri", remove: ['first_seen', 'last_seen'] },
    { name: "Fără info vehicul", remove: ['vehicle_class', 'vehicle_color', 'vehicle_maker'] },
    { name: "Fără metadata", remove: ['transactionkey', 'country_code'] },
    { name: "Doar ESENȚIALE", remove: ['id', 'probability'] },
    { name: "MINIMAL absolut", remove: ['direction'] }
  ];
  
  for (const step of reductionSteps) {
    console.log(`--- ${step.name} ---`);
    
    const form = new FormData();
    const currentData = { ...fullData };
    
    // Elimină câmpurile specificate
    step.remove.forEach(field => delete currentData[field]);
    
    console.log(`📊 Sending fields: ${Object.keys(currentData).join(', ')}`);
    
    Object.keys(currentData).forEach(key => {
      form.append(key, currentData[key]);
    });
    
    try {
      const fetch = (await import('node-fetch')).default;
      const response = await fetch(endpoint, {
        method: 'POST',
        body: form,
        headers: form.getHeaders()
      });
      
      const responseText = await response.text();
      console.log(`📥 Response: ${responseText.includes('open_barrier') ? 'OPEN BARRIER' : 'STANDARD'}`);
      
    } catch (error) {
      console.error(`❌ Error:`, error.message);
    }
    
    await new Promise(resolve => setTimeout(resolve, 300));
  }
}

// Rulează toate testele
async function runRobustnessTests() {
  console.log('🚀 Starting LPR Robustness Tests\n');
  
  console.log('📋 Environment Variables:');
  console.log(`   LPR_ENABLED: ${process.env.LPR_ENABLED || 'default: true'}`);
  console.log(`   LPR_DEBUG_MODE: ${process.env.LPR_DEBUG_MODE || 'default: false'}`);
  console.log(`   LPR_AUTH_SECRET: ${process.env.LPR_AUTH_SECRET ? 'set' : 'not set'}`);
  console.log('');
  
  // Test 1: Scenarii minime
  await testMinimalLPR();
  
  // Test 2: Reducere progresivă
  await testProgressiveReduction();
  
  console.log('\n🏁 Robustness tests completed!');
  console.log('📊 API should handle ALL scenarios gracefully');
}

// Rulează dacă apelat direct
if (require.main === module) {
  runRobustnessTests().catch(console.error);
}

module.exports = { testMinimalLPR, testProgressiveReduction, runRobustnessTests }; 